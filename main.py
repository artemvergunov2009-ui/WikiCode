import os
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")

supabase: Optional[Client] = None

if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"[ОШИБКА SUPABASE]: {e}")


app = FastAPI(title="WikiCode API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")


class FavoriteItem(BaseModel):
    material_id: int


def get_supabase():
    if supabase is None:
        raise HTTPException(
            status_code=503,
            detail="Supabase не настроен или недоступен"
        )

    return supabase


def deduplicate_materials(materials):
    seen = set()
    unique = []

    for material in materials:
        key = (
            material.get("title", "").strip().lower(),
            material.get("language", "").strip().lower()
        )

        if key not in seen:
            seen.add(key)
            unique.append(material)

    return unique


@app.get("/api/materials")
@app.get("/data/materials")
async def get_materials(
    language: Optional[str] = None,
    search: Optional[str] = None
):
    db = get_supabase()

    try:
        query = db.table("materials").select("*")

        if language:
            query = query.eq("language", language)

        if search:
            query = query.ilike("title", f"%{search}%")

        response = query.execute()

        return deduplicate_materials(response.data or [])

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ОШИБКА ЗАГРУЗКИ МАТЕРИАЛОВ]: {e}")
        raise HTTPException(
            status_code=502,
            detail="Не удалось загрузить материалы из Supabase"
        )


@app.get("/api/materials/{material_id}")
async def get_material_by_id(material_id: int):
    db = get_supabase()

    try:
        response = (
            db.table("materials")
            .select("*")
            .eq("id", material_id)
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=404,
                detail="Материал не найден"
            )

        return response.data[0]

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ОШИБКА ЗАГРУЗКИ МАТЕРИАЛА]: {e}")
        raise HTTPException(
            status_code=502,
            detail="Не удалось загрузить материал из Supabase"
        )


@app.get("/api/languages")
async def get_languages():
    materials = await get_materials()

    lang_counts = {}
    categories = set()

    for material in materials:
        language = material.get("language")
        category = material.get("category")

        if language:
            lang_counts[language] = lang_counts.get(language, 0) + 1

        if category:
            categories.add(category)

    topics = [
        {"language": language, "count": count}
        for language, count in lang_counts.items()
    ]

    return {
        "topics": topics,
        "categories": sorted(categories)
    }


@app.get("/api/quizzes")
@app.get("/data/quizzes")
async def get_quizzes(material_id: Optional[int] = None):
    db = get_supabase()

    try:
        query = db.table("quizzes").select("*")

        if material_id is not None:
            query = query.eq("material_id", material_id)

        response = query.execute()

        return response.data or []

    except Exception as e:
        print(f"[ОШИБКА ЗАГРУЗКИ ТЕСТОВ]: {e}")
        raise HTTPException(
            status_code=502,
            detail="Не удалось загрузить тесты из Supabase"
        )


@app.get("/api/favorites")
@app.get("/data/favorites")
async def get_favorites():
    db = get_supabase()

    try:
        response = db.table("favorites").select("*").execute()

        return [
            item["material_id"]
            for item in (response.data or [])
            if "material_id" in item
        ]

    except Exception as e:
        print(f"[ОШИБКА ЗАГРУЗКИ ИЗБРАННОГО]: {e}")
        raise HTTPException(
            status_code=502,
            detail="Не удалось загрузить избранное"
        )


@app.post("/api/favorites")
async def add_favorite(item: FavoriteItem):
    db = get_supabase()

    try:
        db.table("favorites").insert({
            "material_id": item.material_id
        }).execute()

        return {"success": True}

    except Exception as e:
        print(f"[ОШИБКА ДОБАВЛЕНИЯ В ИЗБРАННОЕ]: {e}")
        raise HTTPException(
            status_code=502,
            detail="Не удалось добавить материал в избранное"
        )


@app.delete("/api/favorites/{material_id}")
async def remove_favorite(material_id: int):
    db = get_supabase()

    try:
        db.table("favorites").delete().eq(
            "material_id", material_id
        ).execute()

        return {"success": True}

    except Exception as e:
        print(f"[ОШИБКА УДАЛЕНИЯ ИЗ ИЗБРАННОГО]: {e}")
        raise HTTPException(
            status_code=502,
            detail="Не удалось удалить материал из избранного"
        )


@app.get("/")
async def read_index():
    index_path = os.path.join(PUBLIC_DIR, "index.html")

    if not os.path.exists(index_path):
        raise HTTPException(
            status_code=404,
            detail="Файл index.html не найден"
        )

    return FileResponse(index_path)


app.mount(
    "/",
    StaticFiles(directory=PUBLIC_DIR),
    name="static"
)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True
    )
