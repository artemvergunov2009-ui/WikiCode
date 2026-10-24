import json
import os
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
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


app = FastAPI(title="WikiCode")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app.mount(
    "/static",
    StaticFiles(directory=os.path.join(BASE_DIR, "static")),
    name="static"
)

templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))


# ---------- Работа с базой ----------

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


def load_materials(language="", category="", search=""):
    db = get_supabase()

    try:
        query = db.table("materials").select("*")

        if language:
            query = query.eq("language", language)

        if category:
            query = query.eq("category", category)

        if search:
            query = query.ilike("title", f"%{search}%")

        response = query.execute()
        return deduplicate_materials(response.data or [])

    except Exception as e:
        print(f"[ОШИБКА ЗАГРУЗКИ МАТЕРИАЛОВ]: {e}")
        raise HTTPException(
            status_code=502,
            detail="Не удалось загрузить материалы из Supabase"
        )


def load_material(material_id):
    db = get_supabase()

    try:
        response = (
            db.table("materials")
            .select("*")
            .eq("id", material_id)
            .execute()
        )
    except Exception as e:
        print(f"[ОШИБКА ЗАГРУЗКИ МАТЕРИАЛА]: {e}")
        raise HTTPException(
            status_code=502,
            detail="Не удалось загрузить материал из Supabase"
        )

    if not response.data:
        raise HTTPException(status_code=404, detail="Материал не найден")

    return response.data[0]


def load_questions(material_id):
    db = get_supabase()

    try:
        response = (
            db.table("quizzes")
            .select("*")
            .eq("material_id", material_id)
            .execute()
        )
    except Exception as e:
        print(f"[ОШИБКА ЗАГРУЗКИ ТЕСТОВ]: {e}")
        return []

    if not response.data:
        return []

    questions = response.data[0].get("questions")

    # иногда JSON хранится как строка
    if isinstance(questions, str):
        try:
            questions = json.loads(questions)
        except ValueError:
            return []

    if not isinstance(questions, list):
        return []

    return questions


def load_favorite_ids():
    db = get_supabase()

    try:
        response = db.table("favorites").select("*").execute()
    except Exception as e:
        print(f"[ОШИБКА ЗАГРУЗКИ ИЗБРАННОГО]: {e}")
        return []

    return [
        item["material_id"]
        for item in (response.data or [])
        if "material_id" in item
    ]


def get_filter_options():
    """Списки языков и тем для выпадающих списков."""
    materials = load_materials()

    lang_counts = {}
    categories = set()

    for material in materials:
        language = material.get("language")
        category = material.get("category")

        if language:
            lang_counts[language] = lang_counts.get(language, 0) + 1

        if category:
            categories.add(category)

    languages = [
        {"language": name, "count": count}
        for name, count in lang_counts.items()
    ]

    return materials, languages, sorted(categories)


def current_url(request: Request):
    """Адрес текущей страницы (чтобы вернуться на неё после нажатия на ☆)."""
    url = request.url.path
    if request.url.query:
        url += "?" + request.url.query
    return url


# ---------- Страницы ----------

@app.get("/")
def home(request: Request):
    materials, languages, categories = get_filter_options()

    # карточки языков: название + примеры тем
    groups = {}
    for material in materials:
        language = material.get("language")
        if not language:
            continue
        groups.setdefault(language, []).append(material.get("title", ""))

    language_cards = [
        {"language": name, "titles": titles}
        for name, titles in groups.items()
    ]

    return templates.TemplateResponse(request, "home.html", {
        "active": "home",
        "language_cards": language_cards,
        "languages": languages,
        "categories": categories,
        "selected_language": "",
        "selected_category": "",
    })


@app.get("/catalog")
def catalog(
    request: Request,
    language: str = "",
    category: str = "",
    search: str = ""
):
    search = search.strip()

    _, languages, categories = get_filter_options()
    materials = load_materials(language, category, search)

    return templates.TemplateResponse(request, "catalog.html", {
        "active": "catalog",
        "materials": materials,
        "favorites": load_favorite_ids(),
        "languages": languages,
        "categories": categories,
        "selected_language": language,
        "selected_category": category,
        "search": search,
        "back": current_url(request),
    })


@app.get("/favorites")
def favorites_page(request: Request):
    favorite_ids = load_favorite_ids()
    materials = [
        m for m in load_materials()
        if m["id"] in favorite_ids
    ]

    return templates.TemplateResponse(request, "favorites.html", {
        "active": "favorites",
        "materials": materials,
        "favorites": favorite_ids,
        "back": "/favorites",
    })


def show_topic(request: Request, material_id: int, answers=None):
    material = load_material(material_id)
    questions = load_questions(material_id)

    score = None
    if answers is not None:
        score = sum(
            1 for i, q in enumerate(questions)
            if answers.get(i) == q.get("correct")
        )

    return templates.TemplateResponse(request, "topic.html", {
        "active": "catalog",
        "material": material,
        "questions": questions,
        "favorites": load_favorite_ids(),
        "answers": answers,
        "score": score,
    })


@app.get("/topic/{material_id}")
def topic(request: Request, material_id: int):
    return show_topic(request, material_id)


@app.post("/topic/{material_id}/quiz")
async def check_quiz(request: Request, material_id: int):
    form = await request.form()

    # поля формы называются q0, q1, q2 ... , значение — номер выбранного ответа
    answers = {}
    for key, value in form.items():
        if key.startswith("q") and key[1:].isdigit() and str(value).isdigit():
            answers[int(key[1:])] = int(value)

    return show_topic(request, material_id, answers)


# ---------- Избранное ----------

@app.post("/favorites/toggle")
def toggle_favorite(
    material_id: int = Form(...),
    back: str = Form("/favorites")
):
    db = get_supabase()

    try:
        if material_id in load_favorite_ids():
            db.table("favorites").delete().eq(
                "material_id", material_id
            ).execute()
        else:
            db.table("favorites").insert({
                "material_id": material_id
            }).execute()
    except Exception as e:
        print(f"[ОШИБКА ИЗБРАННОГО]: {e}")
        raise HTTPException(
            status_code=502,
            detail="Не удалось изменить избранное"
        )

    # возвращаемся только на страницы нашего сайта
    if not back.startswith("/") or back.startswith("//"):
        back = "/favorites"

    return RedirectResponse(back, status_code=303)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True
    )
