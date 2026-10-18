function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function api(url, options) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || error.detail || 'Ошибка запроса');
        }
        return await response.json();
    } catch (err) {
        console.error(`Ошибка запроса ${url}:`, err);
        throw err;
    }
}

let allMaterials = [];
let favorites = [];

function showPage(name) {
    const pages = ['page-home', 'page-catalog', 'page-favorites', 'page-topic'];
    pages.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', id !== 'page-' + name);
    });

    const navHome = document.getElementById('nav-home');
    const navCatalog = document.getElementById('nav-catalog');
    const navFav = document.getElementById('nav-favorites');

    if (navHome) navHome.classList.toggle('active', name === 'home');
    if (navCatalog) navCatalog.classList.toggle('active', name === 'catalog');
    if (navFav) navFav.classList.toggle('active', name === 'favorites');

    window.scrollTo(0, 0);
}

function renderCard(material) {
    const isFav = favorites.includes(material.id);
    const description = material.description || material.content || '';
    return `
        <div class="card">
            <div class="card-top">
                <span class="badge">${escapeHtml(material.language || 'Code')}</span>
                <button class="btn-fav ${isFav ? 'active' : ''}" data-fav="${material.id}" title="В избранное">
                    ${isFav ? '★' : '☆'}
                </button>
            </div>
            <h3>${escapeHtml(material.title || 'Без названия')}</h3>
            <p>${escapeHtml(description.slice(0, 90))}${description.length > 90 ? '...' : ''}</p>
            <div class="card-actions">
                <button class="btn" data-topic="${material.id}">Открыть тему</button>
            </div>
        </div>
    `;
}

function bindCardEvents(container) {
    if (!container) return;
    container.querySelectorAll('[data-topic]').forEach((btn) => {
        btn.addEventListener('click', () => openTopic(Number(btn.dataset.topic)));
    });
    container.querySelectorAll('[data-fav]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = Number(btn.dataset.fav);
            if (favorites.includes(id)) {
                favorites = favorites.filter((f) => f !== id);
                await api('/api/favorites/' + id, { method: 'DELETE' });
            } else {
                favorites.push(id);
                await api('/api/favorites', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ material_id: id })
                });
            }
            refreshFavorites();
        });
    });
}

function refreshFavorites() {
    renderLanguageCards(allMaterials);
    renderCatalog(allMaterials);
    renderFavorites();
}

function renderLanguageCards(list) {
    const container = document.getElementById('language-cards');
    if (!container) return;

    const languages = {};
    list.forEach((m) => {
        if (!m.language) return;
        if (!languages[m.language]) {
            languages[m.language] = { language: m.language, topics: [] };
        }
        languages[m.language].topics.push(m.title);
    });

    container.innerHTML = Object.values(languages)
        .map(
            (lang) => `
        <div class="card">
            <span class="badge">${escapeHtml(lang.language)}</span>
            <h3>${escapeHtml(lang.language)}</h3>
            <p>${escapeHtml(lang.topics.slice(0, 3).join(', '))}${lang.topics.length > 3 ? '...' : ''}</p>
            <div class="card-actions">
                <button class="btn" data-lang="${escapeHtml(lang.language)}">Смотреть темы (${lang.topics.length})</button>
            </div>
        </div>
    `
        )
        .join('');

    container.querySelectorAll('[data-lang]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const langSelect = document.getElementById('filter-language');
            const catSelect = document.getElementById('filter-category');
            if (langSelect) langSelect.value = btn.dataset.lang;
            if (catSelect) catSelect.value = '';
            updateFilters();
            showPage('catalog');
        });
    });
}

function renderCatalog(list) {
    const langSelect = document.getElementById('filter-language');
    const catSelect = document.getElementById('filter-category');
    
    const language = langSelect ? langSelect.value : '';
    const category = catSelect ? catSelect.value : '';

    let filtered = list;
    if (language) filtered = filtered.filter((m) => m.language === language);
    if (category) filtered = filtered.filter((m) => m.category === category);

    const titleEl = document.getElementById('catalog-title');
    const countEl = document.getElementById('materials-count') || document.getElementById('catalog-subtitle');

    if (titleEl && language) titleEl.textContent = language;
    if (countEl) {
        countEl.textContent = `Найдено тем: ${filtered.length}`;
    }

    const container = document.getElementById('materials-grid') || document.getElementById('material-list');
    if (container) {
        if (filtered.length === 0) {
            container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #6b7280; margin-top:20px;">Темы не найдены.</p>';
        } else {
            container.innerHTML = filtered.map(renderCard).join('');
            bindCardEvents(container);
        }
    }
}

async function updateFilters() {
    try {
        allMaterials = await api('/api/materials');
        renderCatalog(allMaterials);
    } catch (e) {}
}

async function setupFilters() {
    try {
        const data = await api('/api/languages');

        const langSelect = document.getElementById('filter-language');
        if (langSelect && data.topics) {
            langSelect.innerHTML = '<option value="">Все языки</option>';
            data.topics.forEach((t) => {
                const option = document.createElement('option');
                option.value = t.language;
                option.textContent = `${t.language} (${t.count})`;
                langSelect.appendChild(option);
            });
            langSelect.addEventListener('change', updateFilters);
        }

        const catSelect = document.getElementById('filter-category');
        if (catSelect && data.categories) {
            catSelect.innerHTML = '<option value="">Все темы</option>';
            data.categories.forEach((c) => {
                const option = document.createElement('option');
                option.value = c;
                option.textContent = c;
                catSelect.appendChild(option);
            });
            catSelect.addEventListener('change', updateFilters);
        }
    } catch (e) {}

    const resetBtn = document.getElementById('filter-reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            const langSelect = document.getElementById('filter-language');
            const catSelect = document.getElementById('filter-category');
            if (langSelect) langSelect.value = '';
            if (catSelect) catSelect.value = '';
            const searchInput = document.getElementById('search-input');
            if (searchInput) searchInput.value = '';
            updateFilters();
            showPage('home');
        });
    }
}

async function runSearch() {
    const searchInput = document.getElementById('search-input');
    const term = searchInput ? searchInput.value.trim() : '';
    
    try {
        allMaterials = await api('/api/materials' + (term ? '?search=' + encodeURIComponent(term) : ''));
    } catch (e) {
        allMaterials = [];
    }

    const langSelect = document.getElementById('filter-language');
    const catSelect = document.getElementById('filter-category');
    if (langSelect) langSelect.value = '';
    if (catSelect) catSelect.value = '';

    const titleEl = document.getElementById('catalog-title');
    const countEl = document.getElementById('materials-count') || document.getElementById('catalog-subtitle');

    if (titleEl) titleEl.textContent = term ? `Поиск: «${term}»` : 'Справочник';
    if (countEl) {
        countEl.textContent = `Найдено тем: ${allMaterials.length}`;
    }

    const container = document.getElementById('materials-grid') || document.getElementById('material-list');
    if (container) {
        if (allMaterials.length === 0) {
            container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #6b7280; margin-top:20px;">Ничего не найдено.</p>';
        } else {
            container.innerHTML = allMaterials.map(renderCard).join('');
            bindCardEvents(container);
        }
    }
    showPage('catalog');
}

// ---------- Открытие темы ----------

async function openTopic(id) {
    try {
        const material = await api('/api/materials/' + id);
        const isFav = favorites.includes(material.id);

        const card = document.getElementById('topic-card');
        if (card) {
            card.innerHTML = `
                <div class="topic-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h1 style="margin:0;">${escapeHtml(material.title || '')}</h1>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <span class="badge">${escapeHtml(material.language || '')}</span>
                        <button class="btn-fav ${isFav ? 'active' : ''}" id="topic-fav" title="В избранное">
                            ${isFav ? '★ В избранном' : '☆ В избранное'}
                        </button>
                    </div>
                </div>
                <p class="description" style="font-size:1.1rem; color:#374151; margin-bottom:20px;">
                    ${escapeHtml(material.description || material.content || '')}
                </p>
                ${material.code ? `
                <div class="code-block" style="position:relative; background:#1e293b; color:#f8fafc; padding:20px; border-radius:8px; margin-bottom:30px;">
                    <button class="copy-btn" id="copy-btn" style="position:absolute; top:10px; right:10px; padding:6px 12px; background:#22c55e; color:#fff; border:none; border-radius:4px; cursor:pointer;">Копировать</button>
                    <pre style="margin:0; overflow-x:auto;"><code>${escapeHtml(material.code)}</code></pre>
                </div>
                ` : ''}
                <div id="quiz-block" class="quiz-block" style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                    <h2>Проверь себя (Мини-тест)</h2>
                    <div id="quiz-content"></div>
                </div>
            `;

            const copyBtn = document.getElementById('copy-btn');
            if (copyBtn) {
                copyBtn.addEventListener('click', function () {
                    navigator.clipboard.writeText(material.code || '').then(() => {
                        this.textContent = 'Скопировано!';
                        setTimeout(() => (this.textContent = 'Копировать'), 1500);
                    });
                });
            }

            const favBtn = document.getElementById('topic-fav');
            if (favBtn) {
                favBtn.addEventListener('click', async function () {
                    if (favorites.includes(material.id)) {
                        favorites = favorites.filter((f) => f !== material.id);
                        await api('/api/favorites/' + material.id, { method: 'DELETE' });
                    } else {
                        favorites.push(material.id);
                        await api('/api/favorites', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ material_id: material.id })
                        });
                    }
                    refreshFavorites();
                    this.textContent = favorites.includes(material.id) ? '★ В избранном' : '☆ В избранное';
                    this.classList.toggle('active', favorites.includes(material.id));
                });
            }
        }

        await loadQuiz(material.id);
        showPage('topic');
    } catch (e) {
        console.error("Ошибка открытия темы:", e);
    }
}

async function loadQuiz(materialId) {
    const block = document.getElementById('quiz-block');
    const content = document.getElementById('quiz-content');
    if (!block || !content) return;

    try {
        const quizzes = await api('/api/quizzes?material_id=' + materialId);
        if (!quizzes || quizzes.length === 0) {
            block.style.display = 'none';
            return;
        }

        const quiz = quizzes[0];
        let questions = quiz.questions;

        if (typeof questions === 'string') {
            try { questions = JSON.parse(questions); } catch(e) {}
        }

        if (!questions || !Array.isArray(questions) || questions.length === 0) {
            block.style.display = 'none';
            return;
        }

        block.style.display = 'block';
        content.innerHTML = '';
        let correctCount = 0;
        let answered = 0;

        questions.forEach((q, index) => {
            const div = document.createElement('div');
            div.className = 'quiz-question';
            div.style.marginBottom = '20px';
            div.innerHTML = `<p style="font-weight:600; margin-bottom:8px;">${index + 1}. ${escapeHtml(q.question)}</p>`;

            const options = document.createElement('div');
            options.className = 'quiz-options';
            options.style.display = 'flex';
            options.style.flexDirection = 'column';
            options.style.gap = '8px';

            const opts = q.options || [];
            opts.forEach((option, optionIndex) => {
                const btn = document.createElement('button');
                btn.className = 'btn';
                btn.style.textAlign = 'left';
                btn.style.background = '#f3f4f6';
                btn.style.color = '#1f2937';
                btn.textContent = option;

                btn.addEventListener('click', () => {
                    if (options.dataset.answered) return;
                    options.dataset.answered = 'true';
                    answered++;

                    const buttons = options.querySelectorAll('button');
                    if (buttons[q.correct]) {
                        buttons[q.correct].style.background = '#22c55e';
                        buttons[q.correct].style.color = '#fff';
                    }
                    if (optionIndex !== q.correct) {
                        btn.style.background = '#ef4444';
                        btn.style.color = '#fff';
                    } else {
                        correctCount++;
                    }

                    if (answered === questions.length) {
                        const result = document.createElement('div');
                        result.style.marginTop = '15px';
                        result.style.fontWeight = 'bold';
                        result.textContent = `Результат: ${correctCount} из ${questions.length}`;
                        content.appendChild(result);
                    }
                });
                options.appendChild(btn);
            });

            div.appendChild(options);
            content.appendChild(div);
        });
    } catch (e) {
        console.error("Ошибка загрузки квиза:", e);
        block.style.display = 'none';
    }
}

// ---------- Избранное ----------

async function renderFavorites() {
    const container = document.getElementById('favorites-list');
    if (!container) return;

    const favMaterials = allMaterials.filter((m) => favorites.includes(m.id));

    if (favMaterials.length === 0) {
        container.innerHTML =
            '<div class="empty" style="text-align:center; color:#6b7280; padding:20px;">Здесь пока пусто. Нажмите ☆ на любой теме, чтобы сохранить её.</div>';
        return;
    }

    container.innerHTML = favMaterials.map(renderCard).join('');
    bindCardEvents(container);
}

// ---------- Инициализация ----------

async function init() {
    try {
        allMaterials = await api('/api/materials').catch(() => []);
        favorites = await api('/api/favorites').catch(() => []);

        await setupFilters();
        renderLanguageCards(allMaterials);
        renderCatalog(allMaterials);
        renderFavorites();
    } catch (err) {
        console.error('Ошибка инициализации:', err);
    }

    const logo = document.getElementById('logo');
    if (logo) logo.addEventListener('click', (e) => { e.preventDefault(); showPage('home'); });

    const navHome = document.getElementById('nav-home');
    if (navHome) navHome.addEventListener('click', (e) => { e.preventDefault(); showPage('home'); });

    const navCatalog = document.getElementById('nav-catalog');
    if (navCatalog) navCatalog.addEventListener('click', (e) => {
        e.preventDefault();
        const langSelect = document.getElementById('filter-language');
        const catSelect = document.getElementById('filter-category');
        if (langSelect) langSelect.value = '';
        if (catSelect) catSelect.value = '';
        updateFilters();
        showPage('catalog');
    });

    const navFav = document.getElementById('nav-favorites');
    if (navFav) navFav.addEventListener('click', (e) => { 
        e.preventDefault(); 
        renderFavorites();
        showPage('favorites'); 
    });

    const backHome = document.getElementById('back-home');
    if (backHome) backHome.addEventListener('click', () => showPage('home'));

    const backHome2 = document.getElementById('back-home-2');
    if (backHome2) backHome2.addEventListener('click', () => showPage('home'));

    const backCatalog = document.getElementById('back-catalog');
    if (backCatalog) backCatalog.addEventListener('click', () => showPage('catalog'));

    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) searchBtn.addEventListener('click', runSearch);

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') runSearch();
        });
    }
}

init();