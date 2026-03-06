from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import asyncio
import os
from supabase import create_client, Client
from dotenv import load_dotenv
import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.mask import mask
from rasterio.features import geometry_mask
from rasterio.warp import reproject, Resampling
from shapely.geometry import shape, mapping
from shapely.ops import transform as shapely_transform
from io import BytesIO
from PIL import Image, ImageFilter
from pyproj import Transformer

# Load .env from root
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path)

app = FastAPI(title="iParcel Satellite API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Supabase setup
url: str = os.environ.get("VITE_SUPABASE_URL")
key: str = os.environ.get("VITE_SUPABASE_ANON_KEY")
service_key: str = os.environ.get("SUPABASE_SERVICE_KEY")
if not url or not key:
    print("Warning: Supabase credentials not found in environment")
    supabase = None
else:
    supabase: Client = create_client(url, key)

# Service-role client for Storage uploads (bypasses RLS)
if url and service_key:
    supabase_admin: Client = create_client(url, service_key)
else:
    supabase_admin = supabase
    print("Warning: SUPABASE_SERVICE_KEY not set, using anon key for storage (may fail)")

STORAGE_BUCKET = "ndvi-images"

# Note: The storage bucket 'ndvi-images' must be created manually
# in the Supabase dashboard as a public bucket (RLS prevents auto-creation).

class AnalyzeRequest(BaseModel):
    token: str = None
    exploitation_id: str
    parcel_id: str
    feature: dict


def ndvi_to_grayscale_rgba(ndvi, parcel_mask):
    """Convert raw NDVI (-1..1) to grayscale RGBA, clipped to parcel.
    Maps NDVI linearly to 0-255 so the frontend can apply its own colormap."""
    h, w = ndvi.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    valid = parcel_mask & ~np.isnan(ndvi)
    # Map NDVI from [-1, 1] to [0, 255]
    gray = np.clip((ndvi + 1.0) * 127.5, 0, 255).astype(np.uint8)

    rgba[:, :, 0] = gray
    rgba[:, :, 1] = gray
    rgba[:, :, 2] = gray
    rgba[valid, 3] = 255
    rgba[~valid, 3] = 0
    return rgba


def array_to_png_bytes(arr):
    """Convert numpy array (H, W, 4) to PNG bytes."""
    img = Image.fromarray(arr.astype('uint8'), 'RGBA')
    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.getvalue()


def upload_to_storage(png_bytes: bytes, path: str) -> str:
    """Upload PNG bytes to Supabase Storage using admin client and return public URL."""
    try:
        supabase_admin.storage.from_(STORAGE_BUCKET).remove([path])
    except Exception:
        pass
    supabase_admin.storage.from_(STORAGE_BUCKET).upload(
        path, png_bytes, {"content-type": "image/png", "upsert": "true"}
    )
    res = supabase_admin.storage.from_(STORAGE_BUCKET).get_public_url(path)
    return res


async def calc_ndvi_timepoint(client: Client, feature_geom, year, month, exploitation_id, parcel_id):
    """Calculate NDVI for a single month, upload images to Storage, return metadata."""
    bbox_wgs = feature_geom.bounds
    start_date = f"{year}-{month}-01T00:00:00Z"
    last_day = 31 if int(month) in [1,3,5,7,8,10,12] else 30 if int(month) != 2 else 28
    end_date = f"{year}-{month}-{last_day}T23:59:59Z"

    stac_url = "https://earth-search.aws.element84.com/v1/search"
    async with httpx.AsyncClient() as http:
        resp = await http.post(stac_url, json={
            "collections": ["sentinel-2-l2a"],
            "bbox": bbox_wgs,
            "datetime": f"{start_date}/{end_date}",
            "limit": 10,
            "query": {"eo:cloud_cover": {"lte": 30}},
            "sortby": [{"field": "properties.eo:cloud_cover", "direction": "asc"}]
        }, timeout=30.0)
        data = resp.json()

    if not data.get("features"):
        return None

    # Try candidates sorted by cloud cover, pick the one with least clouds over the parcel
    best_result = None
    best_cloud_pct = 100.0

    for stac_feature in data["features"]:
        assets = stac_feature["assets"]
        red_url = assets["red"]["href"]
        nir_url = assets["nir"]["href"]
        scl_url = assets.get("scl", {}).get("href") if "scl" in assets else None

        try:
            with rasterio.open(red_url) as src_red:
                epsg_code = src_red.crs.to_epsg()
                transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg_code}", always_xy=True)
                geom_utm = shapely_transform(transformer.transform, feature_geom)

                red_data, red_transform = mask(src_red, [mapping(geom_utm)], crop=True, pad=True, pad_width=1)
                red = red_data[0].astype(float)
                out_shape = red.shape

                # Create boolean mask: True = inside parcel
                parcel_mask = ~geometry_mask(
                    [mapping(geom_utm)], transform=red_transform, out_shape=out_shape, all_touched=True
                )

                # Check cloud coverage over the parcel using SCL band
                parcel_cloud_pct = 0.0
                if scl_url:
                    try:
                        with rasterio.open(scl_url) as src_scl:
                            scl = np.zeros(out_shape, dtype=np.float32)
                            reproject(
                                source=rasterio.band(src_scl, 1),
                                destination=scl,
                                src_transform=src_scl.transform,
                                src_crs=src_scl.crs,
                                dst_transform=red_transform,
                                dst_crs=src_red.crs,
                                resampling=Resampling.nearest
                            )
                            scl_int = scl.astype(np.uint8)
                            # SCL classes: 8=cloud_medium, 9=cloud_high, 10=thin_cirrus, 3=cloud_shadow
                            cloud_classes = np.isin(scl_int, [3, 8, 9, 10])
                            parcel_pixels = np.sum(parcel_mask)
                            if parcel_pixels > 0:
                                parcel_cloud_pct = float(np.sum(cloud_classes & parcel_mask)) / parcel_pixels * 100
                    except Exception as e:
                        print(f"  SCL check failed: {e}")
                        parcel_cloud_pct = stac_feature["properties"].get("eo:cloud_cover", 50)

                print(f"  Candidate {stac_feature['properties']['datetime']}: tile cloud={stac_feature['properties'].get('eo:cloud_cover', '?')}%, parcel cloud={parcel_cloud_pct:.1f}%")

                if parcel_cloud_pct < best_cloud_pct:
                    best_cloud_pct = parcel_cloud_pct

                    with rasterio.open(nir_url) as src_nir:
                        nir = np.zeros(out_shape, dtype=np.float32)
                        reproject(
                            source=rasterio.band(src_nir, 1),
                            destination=nir,
                            src_transform=src_nir.transform,
                            src_crs=src_nir.crs,
                            dst_transform=red_transform,
                            dst_crs=src_red.crs,
                            resampling=Resampling.bilinear
                        )

                    visual_url = assets["visual"]["href"]
                    with rasterio.open(visual_url) as src_vis:
                        vis = np.zeros((3, *out_shape), dtype=np.float32)
                        for b in range(3):
                            reproject(
                                source=rasterio.band(src_vis, b + 1),
                                destination=vis[b],
                                src_transform=src_vis.transform,
                                src_crs=src_vis.crs,
                                dst_transform=red_transform,
                                dst_crs=src_red.crs,
                                resampling=Resampling.bilinear
                            )

                    best_result = {
                        "red": red, "nir": nir, "vis": vis,
                        "parcel_mask": parcel_mask, "red_transform": red_transform,
                        "epsg_code": epsg_code, "stac_feature": stac_feature,
                        "out_shape": out_shape
                    }

                    # If parcel is cloud-free, no need to check more candidates
                    if parcel_cloud_pct < 5:
                        break

        except Exception as e:
            print(f"  Candidate failed: {e}")
            continue

    if best_result is None:
        return None

    print(f"  -> Selected: {best_result['stac_feature']['properties']['datetime']} (parcel cloud={best_cloud_pct:.1f}%)")

    red = best_result["red"]
    nir = best_result["nir"]
    vis = best_result["vis"]
    parcel_mask = best_result["parcel_mask"]
    red_transform = best_result["red_transform"]
    epsg_code = best_result["epsg_code"]
    stac_feature = best_result["stac_feature"]
    out_shape = best_result["out_shape"]

    # Compute NDVI
    denom = (nir + red)
    denom[denom == 0] = 1e-9
    ndvi = (nir - red) / denom

    # Generate raw NDVI grayscale image (clipped to parcel)
    h, w = ndvi.shape
    ndvi_rgba = ndvi_to_grayscale_rgba(ndvi, parcel_mask)

    # Generate RGB Image (clipped to parcel)
    rgb_rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for b in range(3):
        rgb_rgba[:, :, b] = np.clip(vis[b], 0, 255).astype(np.uint8)
    rgb_rgba[parcel_mask, 3] = 255
    rgb_rgba[~parcel_mask, 3] = 0

    # Upload to Supabase Storage
    cache_key = f"{year}-{month}"
    base_path = f"{exploitation_id}/{parcel_id}/{cache_key}"
    ndvi_png = array_to_png_bytes(ndvi_rgba)
    rgb_png = array_to_png_bytes(rgb_rgba)
    ndvi_url = upload_to_storage(ndvi_png, f"{base_path}_ndvi.png")
    rgb_url = upload_to_storage(rgb_png, f"{base_path}_rgb.png")

    # Calculate WGS84 corners for MapLibre image source
    inv_transformer = Transformer.from_crs(f"EPSG:{epsg_code}", "EPSG:4326", always_xy=True)

    def px_to_wgs(px, py):
        ux, uy = red_transform * (px, py)
        return inv_transformer.transform(ux, uy)

    coords = [
        list(px_to_wgs(0, 0)),     # TL
        list(px_to_wgs(w, 0)),     # TR
        list(px_to_wgs(w, h)),     # BR
        list(px_to_wgs(0, h))      # BL
    ]

    return {
        "ndviUrl": ndvi_url,
        "rgbUrl": rgb_url,
        "date": stac_feature["properties"]["datetime"],
        "mean": float(np.mean(ndvi[parcel_mask])) if np.any(parcel_mask) else 0.0,
        "coordinates": coords
    }


async def process_satellite_history(token: str, exploitation_id: str, parcel_id: str, feature: dict):
    # Use admin client (service_role) to bypass RLS for all DB operations
    client = supabase_admin if supabase_admin else supabase

    if not client:
        print("Error: Supabase client not initialized")
        return

    try:
        geom_obj = shape(feature['geometry'])

        # Check if there's already partial data (resume support)
        existing_data = {}
        try:
            existing = client.table("exploitation_parcelles").select("ndvi_data").eq(
                "exploitation_id", exploitation_id
            ).eq("parcel_id", parcel_id).execute()
            if existing.data and len(existing.data) > 0 and existing.data[0].get("ndvi_data"):
                existing_data = existing.data[0]["ndvi_data"]
        except Exception as e:
            print(f"Could not fetch existing data (continuing fresh): {e}")

        history = dict(existing_data)  # Start from existing data

        timepoints = []
        for y in range(2023, 2020, -1):
            for m in range(12, 0, -1):
                key = f"{y}-{m:02d}"
                # Skip already computed timepoints (resume support)
                if key in history and history[key] != "ERROR":
                    continue
                timepoints.append((y, f"{m:02d}"))

        if not timepoints:
            # All already computed
            client.table("exploitation_parcelles").update({
                "analysis_status": "Terminée",
                "analysis_progress": 100
            }).eq("exploitation_id", exploitation_id).eq("parcel_id", parcel_id).execute()
            return

        total = len(timepoints)
        BATCH_SIZE = 3

        for batch_start in range(0, total, BATCH_SIZE):
            batch = timepoints[batch_start:batch_start + BATCH_SIZE]
            progress = int((batch_start / total) * 100)

            # Update progress
            labels = ", ".join(f"{m}/{y}" for y, m in batch)
            try:
                client.table("exploitation_parcelles").update({
                    "analysis_status": f"Analyse {labels}...",
                    "analysis_progress": progress
                }).eq("exploitation_id", exploitation_id).eq("parcel_id", parcel_id).execute()
            except Exception as e:
                print(f"Supabase progress update error: {e}")

            # Process batch concurrently
            tasks = [
                calc_ndvi_timepoint(client, geom_obj, year, month, exploitation_id, parcel_id)
                for year, month in batch
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            for (year, month), result in zip(batch, results):
                cache_key = f"{year}-{month}"
                if isinstance(result, Exception):
                    print(f"Error at {cache_key}: {result}")
                    history[cache_key] = "ERROR"
                elif result is None:
                    history[cache_key] = "ERROR"
                else:
                    history[cache_key] = result

            # Save incrementally after each batch
            try:
                client.table("exploitation_parcelles").update({
                    "ndvi_data": history,
                    "analysis_progress": int(((batch_start + len(batch)) / total) * 100)
                }).eq("exploitation_id", exploitation_id).eq("parcel_id", parcel_id).execute()
            except Exception as e:
                print(f"Supabase incremental save error: {e}")

        # Final update
        client.table("exploitation_parcelles").update({
            "ndvi_data": history,
            "analysis_status": "Terminée",
            "analysis_progress": 100
        }).eq("exploitation_id", exploitation_id).eq("parcel_id", parcel_id).execute()

    except Exception as e:
        print(f"Error processing satellite: {e}")
        try:
            client.table("exploitation_parcelles").update({
                "analysis_status": "Erreur",
                "analysis_progress": 0
            }).eq("exploitation_id", exploitation_id).eq("parcel_id", parcel_id).execute()
        except:
            pass


@app.post("/analyze")
async def start_analysis(req: AnalyzeRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(process_satellite_history, req.token, req.exploitation_id, req.parcel_id, req.feature)
    return {"status": "started", "message": "Analyse lancée en arrière-plan"}

@app.get("/health")
def health():
    return {"status": "ok"}
