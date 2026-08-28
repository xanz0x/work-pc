# -*- coding: utf-8 -*-
"""Генератор интерактивного PDF-отчёта аудита WorkfloW (reportlab, AcroForm)."""

import os
import sys

from reportlab.lib.colors import HexColor, Color
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdfcanvas

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audit_content import (  # noqa: E402
    META, FACTS, VERDICT, MATRIX, GOOD, ITEMS, NOTIF_NOW, NOTIF_DEFECTS,
    NOTIF_MODEL, NOTIF_DECISION, NOTIF_DOD, PROTO_SIGNS, CHECKLIST, ROADMAP,
    APPROVAL,
)

FONT_DIR = "/usr/share/fonts/truetype/liberation"
pdfmetrics.registerFont(TTFont("S", f"{FONT_DIR}/LiberationSans-Regular.ttf"))
pdfmetrics.registerFont(TTFont("SB", f"{FONT_DIR}/LiberationSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("M", f"{FONT_DIR}/LiberationMono-Regular.ttf"))
pdfmetrics.registerFont(TTFont("MB", f"{FONT_DIR}/LiberationMono-Bold.ttf"))

BG = HexColor("#05080B")
PANEL = HexColor("#0B1015")
PANEL2 = HexColor("#0E141A")
LINE = HexColor("#1A242C")
LINE2 = HexColor("#243139")
TXT = HexColor("#E7EEF4")
MUT = HexColor("#7E8D9B")
DIM = HexColor("#5B6874")
ACC = HexColor("#2FBE7E")
RED = HexColor("#E5534B")
ORG = HexColor("#E0A33E")
BLU = HexColor("#4C9AE8")

PRIO_COLOR = {"P0": RED, "P1": ORG, "P2": BLU, "P3": DIM}
ACT_COLOR = {
    "ОСТАВИТЬ": ACC, "ДОРАБОТАТЬ": ACC, "ИЗМЕНИТЬ": ORG,
    "УДАЛИТЬ": RED, "ПЕРЕНЕСТИ / ОБЪЕДИНИТЬ": BLU, "НОВАЯ ФИЧА": BLU,
}

W, H = A4
ML, MR, MT, MB_ = 44, 44, 54, 46
CW = W - ML - MR

SECTIONS = [
    ("1", "Как читать документ", "howto"),
    ("2", "Executive summary и матрица оценки", "exec"),
    ("3", "Что уже сделано хорошо", "good"),
    ("4", "Критические проблемы · P0", "crit"),
    ("5", "Уведомления: полная модель", "notif"),
    ("6", "UX / UI изменения", "ux"),
    ("7", "Изменения логики", "logic"),
    ("8", "Архитектурные изменения", "arch"),
    ("9", "Убрать · объединить · изменить", "remove"),
    ("10", "Новые функции", "feat"),
    ("11", "Прототип vs приложение", "proto"),
    ("12", "Production checklist", "check"),
    ("13", "Приоритизированный roadmap", "road"),
    ("14", "Лист утверждения и подпись", "sign"),
]


class Doc:
    def __init__(self, path, pages=None):
        self.c = pdfcanvas.Canvas(path, pagesize=A4)
        self.c.setTitle("WorkfloW · Экспертный аудит и план перехода в production")
        self.c.setAuthor("Product audit")
        self.c.setSubject(META["version"])
        self.pages = pages or {}
        self.pagemap = {}
        self.page_no = 0
        self.cur = ""
        self.chrome = True
        self.y = H - MT
        self.fields = set()
        self._page_bg()

    # ---------- низкий уровень ----------
    def _page_bg(self):
        self.page_no += 1
        c = self.c
        c.setFillColor(BG)
        c.rect(0, 0, W, H, stroke=0, fill=1)

    def header(self):
        c = self.c
        c.setStrokeColor(LINE)
        c.setLineWidth(0.6)
        c.line(ML, H - 40, W - MR, H - 40)
        c.setFont("MB", 7)
        c.setFillColor(ACC)
        c.drawString(ML, H - 34, "WORKFLO")
        wt = c.stringWidth("WORKFLO", "MB", 7)
        c.setFillColor(TXT)
        c.drawString(ML + wt, H - 34, "W")
        c.setFont("M", 7)
        c.setFillColor(DIM)
        c.drawString(ML + wt + 8, H - 34, "· AUDIT v1.0 · ИЮНЬ 2026")
        if self.cur:
            c.setFillColor(MUT)
            c.drawRightString(W - MR, H - 34, self.cur.upper()[:58])

    def footer(self):
        c = self.c
        c.setStrokeColor(LINE)
        c.setLineWidth(0.6)
        c.line(ML, 40, W - MR, 40)
        c.setFont("M", 7)
        c.setFillColor(DIM)
        c.drawString(ML, 30, "ИНТЕРАКТИВНЫЙ ДОКУМЕНТ")
        c.setFillColor(MUT)
        c.drawRightString(W - MR, 30, f"{self.page_no:02d}")
        # ссылка «к оглавлению»
        if "toc" in self.pages:
            c.setFillColor(DIM)
            label = "К ОГЛАВЛЕНИЮ"
            tw = c.stringWidth(label, "M", 7)
            x = (W - tw) / 2
            c.drawString(x, 30, label)
            c.linkAbsolute("", "toc", (x - 4, 26, x + tw + 4, 38), thickness=0)

    def new_page(self):
        if self.chrome:
            self.header()
            self.footer()
        self.chrome = True
        self.c.showPage()
        self._page_bg()
        self.y = H - MT

    def ensure(self, h):
        if self.y - h < MB_ + 24:
            self.new_page()
            return True
        return False

    def field_name(self, base):
        n, i = base, 1
        while n in self.fields:
            i += 1
            n = f"{base}_{i}"
        self.fields.add(n)
        return n

    # ---------- текст ----------
    def wrap(self, text, font, size, width):
        out = []
        for para in text.split("\n"):
            words, line = para.split(" "), ""
            for w in words:
                t = f"{line} {w}".strip()
                if self.c.stringWidth(t, font, size) <= width or not line:
                    line = t
                else:
                    out.append(line)
                    line = w
            out.append(line)
        return out

    def para(self, text, font="S", size=9, color=TXT, lead=12.4, x=None, width=None, gap=6):
        x = ML if x is None else x
        width = CW if width is None else width
        lines = self.wrap(text, font, size, width)
        self.ensure(len(lines) * lead + gap)
        self.c.setFont(font, size)
        self.c.setFillColor(color)
        for ln in lines:
            if self.y - lead < MB_ + 24:
                self.new_page()
                self.c.setFont(font, size)
                self.c.setFillColor(color)
            self.y -= lead
            self.c.drawString(x, self.y, ln)
        self.y -= gap

    def label(self, text, color=None, size=7.5, gap=4):
        self.ensure(14)
        self.y -= 10
        self.c.setFont("MB", size)
        self.c.setFillColor(color or DIM)
        self.c.drawString(ML, self.y, text.upper())
        self.y -= gap

    def h2(self, text, color=None):
        self.ensure(34)
        self.y -= 20
        self.c.setFont("SB", 12.5)
        self.c.setFillColor(color or TXT)
        self.c.drawString(ML, self.y, text)
        self.y -= 6
        self.c.setStrokeColor(LINE)
        self.c.setLineWidth(0.6)
        self.c.line(ML, self.y, W - MR, self.y)
        self.y -= 8

    def bullets(self, rows, font="S", size=9, color=TXT, marker="—"):
        for r in rows:
            lines = self.wrap(r, font, size, CW - 14)
            self.ensure(len(lines) * 12 + 4)
            self.c.setFont("M", size)
            self.c.setFillColor(ACC)
            self.y -= 12
            self.c.drawString(ML, self.y, marker)
            self.c.setFont(font, size)
            self.c.setFillColor(color)
            self.c.drawString(ML + 14, self.y, lines[0])
            for ln in lines[1:]:
                self.y -= 12
                if self.y < MB_ + 30:
                    self.new_page()
                    self.y -= 12
                    self.c.setFont(font, size)
                    self.c.setFillColor(color)
                self.c.drawString(ML + 14, self.y, ln)
            self.y -= 3

    def pill(self, x, y, text, color, font="MB", size=6.6, pad=4.5, h=11):
        w = self.c.stringWidth(text, font, size) + pad * 2
        self.c.setFillColor(Color(color.red, color.green, color.blue, 0.14))
        self.c.setStrokeColor(color)
        self.c.setLineWidth(0.5)
        self.c.roundRect(x, y, w, h, 2.2, stroke=1, fill=1)
        self.c.setFont(font, size)
        self.c.setFillColor(color)
        self.c.drawString(x + pad, y + 3.2, text)
        return w

    # ---------- секции ----------
    def section(self, num, title, key, lead_text=None):
        self.new_page()
        self.pagemap[key] = self.page_no
        self.c.bookmarkPage(key)
        self.c.addOutlineEntry(f"{num}. {title}", key, level=0)
        self.cur = f"{num} · {title}"
        c = self.c
        self.y = H - MT - 6
        c.setFont("MB", 26)
        c.setFillColor(HexColor("#16212A"))
        c.drawString(ML, self.y - 20, num.zfill(2))
        c.setFont("SB", 17)
        c.setFillColor(TXT)
        c.drawString(ML + 46, self.y - 14, title)
        self.y -= 34
        c.setStrokeColor(ACC)
        c.setLineWidth(1.2)
        c.line(ML, self.y, ML + 40, self.y)
        c.setStrokeColor(LINE)
        c.setLineWidth(0.6)
        c.line(ML + 40, self.y, W - MR, self.y)
        self.y -= 10
        if lead_text:
            self.para(lead_text, size=9, color=MUT, gap=4)

    # ---------- карточка решения ----------
    def decision_card(self, it):
        rows = [
            ("ПРОБЛЕМА", it["problem"], TXT),
            ("ПРИЧИНА", it["cause"], MUT),
            ("ПРЕДЛАГАЕМОЕ РЕШЕНИЕ", it["fix"], TXT),
            ("ПОЛЬЗОВАТЕЛЬСКАЯ ЦЕННОСТЬ", it["value"], ACC),
            ("ЗАТРОНУТЫЕ ОБЛАСТИ", it["areas"], DIM),
            ("КРИТЕРИЙ ГОТОВНОСТИ", it["dod"], MUT),
        ]
        pad = 11
        inner = CW - pad * 2 - 4
        head_h = 22
        body_h = 0
        wrapped = []
        for lab, txt, col in rows:
            font = "M" if lab == "ЗАТРОНУТЫЕ ОБЛАСТИ" else "S"
            size = 7.6 if font == "M" else 8.6
            lines = self.wrap(txt, font, size, inner - 4)
            wrapped.append((lab, lines, col, font, size))
            body_h += 9 + len(lines) * 11.2 + 3
        dec_h = 30
        total = head_h + body_h + dec_h + pad
        if self.y - total < MB_ + 30:
            self.new_page()
        c = self.c
        top = self.y - 4
        x0 = ML
        c.setFillColor(PANEL)
        c.setStrokeColor(LINE)
        c.setLineWidth(0.7)
        c.roundRect(x0, top - total, CW, total, 3, stroke=1, fill=1)
        pc = PRIO_COLOR[it["prio"]]
        c.setFillColor(pc)
        c.rect(x0, top - total, 2.4, total, stroke=0, fill=1)

        # шапка
        y = top - 15
        c.setFont("MB", 8.6)
        c.setFillColor(pc)
        c.drawString(x0 + pad, y, it["id"])
        idw = c.stringWidth(it["id"], "MB", 8.6)
        ac = ACT_COLOR.get(it["act"], ACC)
        pw = self.pill(x0 + pad + idw + 8, y - 2.6, it["act"], ac)
        tx = x0 + pad + idw + 8 + pw + 8
        c.setFont("SB", 9.6)
        c.setFillColor(TXT)
        title_lines = self.wrap(it["title"], "SB", 9.6, W - MR - tx - 30)
        c.drawString(tx, y, title_lines[0])
        c.setFont("MB", 7.2)
        c.setFillColor(pc)
        c.drawRightString(W - MR - pad, y, it["prio"])
        y -= 15 if len(title_lines) == 1 else 15
        if len(title_lines) > 1:
            c.setFont("SB", 9.6)
            c.setFillColor(TXT)
            c.drawString(x0 + pad, y, title_lines[1])
            y -= 13

        # тело
        for lab, lines, col, font, size in wrapped:
            c.setFont("MB", 6.4)
            c.setFillColor(DIM)
            y -= 9
            c.drawString(x0 + pad, y, lab)
            c.setFont(font, size)
            c.setFillColor(col)
            for ln in lines:
                y -= 11.2
                c.drawString(x0 + pad, y, ln)
            y -= 3

        # решение владельца
        y -= 14
        c.setStrokeColor(LINE2)
        c.setLineWidth(0.5)
        c.line(x0 + pad, y + 9, W - MR - pad, y + 9)
        c.setFont("MB", 6.6)
        c.setFillColor(ACC)
        c.drawString(x0 + pad, y, "РЕШЕНИЕ:")
        cx = x0 + pad + 52
        for lbl, key in (("Утвердить", "ok"), ("Отклонить", "no"), ("Отложить", "later")):
            self.checkbox(cx, y - 2.5, f"{it['id']}_{key}", tip=f"{it['id']} · {lbl}")
            c.setFont("S", 7.8)
            c.setFillColor(MUT)
            c.drawString(cx + 13, y, lbl)
            cx += 13 + c.stringWidth(lbl, "S", 7.8) + 14
        # комментарий
        fw = W - MR - pad - cx - 4
        if fw > 90:
            self.textfield(cx, y - 3.5, fw, 13, f"{it['id']}_note", tip=f"Комментарий к {it['id']}")
        self.y = top - total - 10

    # ---------- интерактив ----------
    def checkbox(self, x, y, name, tip="", size=9.5):
        n = self.field_name(name)
        self.c.acroForm.checkbox(
            name=n, tooltip=tip or n, x=x, y=y, size=size,
            checked=False, buttonStyle="check", shape="square",
            borderStyle="solid", borderWidth=0.7,
            borderColor=HexColor("#3A4A56"), fillColor=HexColor("#141C23"),
            textColor=ACC, forceBorder=True,
        )

    def radio(self, x, y, group, value, name_hint="", size=10, selected=False):
        self.c.acroForm.radio(
            name=group, value=value, tooltip=name_hint or value,
            x=x, y=y, size=size, selected=selected,
            buttonStyle="circle", shape="circle",
            borderStyle="solid", borderWidth=0.8,
            borderColor=HexColor("#3A4A56"), fillColor=HexColor("#141C23"),
            textColor=ACC, forceBorder=True,
        )

    def textfield(self, x, y, w, h, name, tip="", multiline=False, size=8):
        n = self.field_name(name)
        kw = dict(
            name=n, tooltip=tip or n, x=x, y=y, width=w, height=h,
            borderStyle="solid", borderWidth=0.6,
            borderColor=HexColor("#2B3944"), fillColor=HexColor("#0D141A"),
            textColor=HexColor("#DCE6EE"), fontSize=size, fontName="Helvetica",
            forceBorder=True, value="",
        )
        if multiline:
            kw["fieldFlags"] = "multiline"
        self.c.acroForm.textfield(**kw)

    def save(self):
        self.header()
        self.footer()
        self.c.save()


# =====================================================================
#                              СТРАНИЦЫ
# =====================================================================

def cover(d):
    c = d.c
    d.pagemap["cover"] = d.page_no
    d.chrome = False
    c.bookmarkPage("cover")
    # сетка-фон
    c.setStrokeColor(HexColor("#0B1116"))
    c.setLineWidth(0.4)
    for i in range(0, int(W), 26):
        c.line(i, 0, i, H)
    for j in range(0, int(H), 26):
        c.line(0, j, W, j)
    c.setFillColor(ACC)
    c.rect(ML, H - 150, 34, 3, stroke=0, fill=1)
    c.setFont("MB", 8)
    c.setFillColor(ACC)
    c.drawString(ML, H - 178, "WORKFLO")
    wt = c.stringWidth("WORKFLO", "MB", 8)
    c.setFillColor(TXT)
    c.drawString(ML + wt, H - 178, "W")
    c.setFont("M", 8)
    c.setFillColor(DIM)
    c.drawString(ML + wt + 10, H - 178, "· LOCAL AI VAULT")

    c.setFont("SB", 27)
    c.setFillColor(TXT)
    c.drawString(ML, H - 226, "Экспертный аудит продукта")
    c.setFillColor(ACC)
    c.drawString(ML, H - 258, "и план перехода в приложение")
    c.setFont("S", 10.5)
    c.setFillColor(MUT)
    for i, ln in enumerate(d.wrap(
        "Полный проход по продукту, коду, логике, данным, безопасности и готовности к релизу. "
        "Каждое предложение оформлено как решение, которое владелец продукта утверждает или "
        "отклоняет прямо в этом файле.", "S", 10.5, CW - 120)):
        c.drawString(ML, H - 292 - i * 15, ln)

    # факты
    y = H - 400
    c.setFillColor(PANEL)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.roundRect(ML, y - len(FACTS) * 19 - 26, CW, len(FACTS) * 19 + 26, 3, stroke=1, fill=1)
    c.setFont("MB", 7)
    c.setFillColor(DIM)
    c.drawString(ML + 14, y - 4, "ПРЕДМЕТ АУДИТА · ФАКТЫ ИЗ КОДА")
    yy = y - 22
    for k, val in FACTS:
        c.setFont("S", 8.6)
        c.setFillColor(MUT)
        c.drawString(ML + 14, yy, k)
        c.setFont("M", 8.2)
        c.setFillColor(TXT)
        c.drawRightString(W - MR - 14, yy, val)
        c.setStrokeColor(HexColor("#131B21"))
        c.setLineWidth(0.4)
        c.line(ML + 14, yy - 6, W - MR - 14, yy - 6)
        yy -= 19

    # вердикт-плашка
    c.setFillColor(HexColor("#100E0C"))
    c.setStrokeColor(ORG)
    c.setLineWidth(0.8)
    c.roundRect(ML, 128, CW, 92, 3, stroke=1, fill=1)
    c.setFont("MB", 7)
    c.setFillColor(ORG)
    c.drawString(ML + 14, 200, "ИТОГОВАЯ ОЦЕНКА ГОТОВНОСТИ")
    c.setFont("SB", 21)
    c.setFillColor(TXT)
    c.drawString(ML + 14, 172, "48 / 90")
    c.setFont("S", 9)
    c.setFillColor(MUT)
    c.drawString(ML + 96, 176, "продвинутый прототип с продакшн-ядром безопасности")
    c.drawString(ML + 96, 162, "на клиенте · 5 блокеров P0 до релиза")
    c.setFont("M", 7.4)
    c.setFillColor(DIM)
    c.drawString(ML + 14, 140, "ДОКУМЕНТ ИНТЕРАКТИВНЫЙ: ЧЕКБОКСЫ, ПОЛЯ РЕШЕНИЙ И ПОДПИСЬ ЗАПОЛНЯЮТСЯ В PDF-ЧИТАЛКЕ")
    c.setFont("M", 7.4)
    c.setFillColor(DIM)
    c.drawString(ML, 96, f"{META['date']}   ·   {META['version']}   ·   {META['author']}")


def toc(d):
    d.new_page()
    d.pagemap["toc"] = d.page_no
    d.c.bookmarkPage("toc")
    d.c.addOutlineEntry("Оглавление", "toc", level=0)
    d.cur = "Оглавление"
    c = d.c
    d.y = H - MT
    c.setFont("SB", 17)
    c.setFillColor(TXT)
    c.drawString(ML, d.y - 14, "Оглавление")
    c.setFont("S", 9)
    c.setFillColor(MUT)
    c.drawString(ML, d.y - 32, "Названия разделов — активные ссылки. Внизу каждой страницы есть возврат сюда.")
    d.y -= 58
    for num, title, key in SECTIONS:
        page = d.pages.get(key)
        c.setFont("MB", 8)
        c.setFillColor(ACC)
        c.drawString(ML, d.y, num.zfill(2))
        c.setFont("S", 10.2)
        c.setFillColor(TXT)
        c.drawString(ML + 26, d.y, title)
        tw = c.stringWidth(title, "S", 10.2)
        c.setFont("M", 8)
        c.setFillColor(DIM)
        dots_x = ML + 26 + tw + 8
        num_s = f"{page:02d}" if page else "--"
        end_x = W - MR - c.stringWidth(num_s, "M", 8) - 8
        dw = c.stringWidth("·", "M", 8) or 4.8
        n_dots = max(0, int((end_x - dots_x) / dw))
        c.drawString(dots_x, d.y, "·" * n_dots)
        c.setFillColor(MUT)
        c.drawRightString(W - MR, d.y, num_s)
        c.linkAbsolute("", key, (ML, d.y - 4, W - MR, d.y + 11), thickness=0)
        d.y -= 24

    # легенда
    d.y -= 10
    c.setFillColor(PANEL)
    c.setStrokeColor(LINE)
    c.roundRect(ML, d.y - 118, CW, 118, 3, stroke=1, fill=1)
    c.setFont("MB", 7)
    c.setFillColor(DIM)
    c.drawString(ML + 14, d.y - 18, "ЛЕГЕНДА")
    yy = d.y - 38
    legend = [
        ("P0", "Blocker — мешает пользоваться продуктом или создаёт критический риск", RED),
        ("P1", "High — существенно влияет на качество, доверие и стабильность", ORG),
        ("P2", "Medium — заметное улучшение, продукт работает и без него", BLU),
        ("P3", "Nice-to-have — polish и будущее расширение", DIM),
    ]
    for tag, text, col in legend:
        d.pill(ML + 14, yy - 3, tag, col)
        c.setFont("S", 8.6)
        c.setFillColor(MUT)
        c.drawString(ML + 48, yy, text)
        yy -= 17
    c.setFont("S", 8.6)
    c.setFillColor(MUT)
    c.drawString(ML + 14, yy - 4, "Решения по каждому пункту: ОСТАВИТЬ · ДОРАБОТАТЬ · ИЗМЕНИТЬ · УДАЛИТЬ · ПЕРЕНЕСТИ · НОВАЯ ФИЧА")
    d.y -= 128


def sec_howto(d):
    d.section("1", "Как читать документ", "howto",
              "Документ построен как утверждаемый backlog, а не как поток замечаний. "
              "Каждое предложение — отдельная карточка с полем решения.")
    d.h2("Что внутри карточки")
    d.bullets([
        "ID и приоритет — ссылка на пункт в дальнейшей работе (например, «сделай P0-2 и N-3»).",
        "Действие: ОСТАВИТЬ · ДОРАБОТАТЬ · ИЗМЕНИТЬ · УДАЛИТЬ · ПЕРЕНЕСТИ/ОБЪЕДИНИТЬ · НОВАЯ ФИЧА.",
        "Проблема → Причина → Предлагаемое решение → Пользовательская ценность → Затронутые области → Критерий готовности.",
        "Строка «РЕШЕНИЕ»: три чекбокса (Утвердить / Отклонить / Отложить) и поле для комментария.",
    ])
    d.h2("Как утверждать")
    d.bullets([
        "Откройте файл в любой полноценной PDF-читалке (Acrobat, Preview, Foxit, Edge) — поля заполняются прямо в документе и сохраняются вместе с ним.",
        "Проставьте решения по карточкам, которые считаете важными; всё, что осталось пустым, я считаю неутверждённым и не трогаю.",
        "В разделе 5 нужно выбрать один вариант семантики «Очистить» — это единственное место, где требуется ваш выбор, а не согласие.",
        "На последней странице — сводный лист утверждения, свободное поле для решений и подпись.",
        "Присылать обратно файл необязательно: достаточно написать «утверждаю P0-1, P0-2, N-1…N-7, вариант A» — я начну с этого.",
    ], marker="·")
    d.h2("Принципы, которых я придерживался в аудите")
    d.bullets([
        "Ничего не выдумано: каждый дефект подтверждён кодом, файлы и строки указаны в «затронутых областях».",
        "Работающее не переписывается. Крипто-ядро, дизайн-система и модель доски остаются как есть.",
        "Для спорных мест выбран самый консервативный вариант, сохраняющий текущую функциональность.",
        "Функции не удаляются потому, что «кажутся лишними»: удаление предлагается только для мёртвого кода и для того, что вводит пользователя в заблуждение.",
        "Оценка готовности — не оценка качества работы. Прототип этого уровня — сильный результат; речь о дистанции до продукта, за который платят.",
    ])


def sec_exec(d):
    d.section("2", "Executive summary и матрица оценки", "exec")
    d.h2("Главный вывод")
    d.para(VERDICT, size=9.4, lead=13)

    d.h2("Матрица оценки по областям")
    c = d.c
    for area, score, checked, verdict in MATRIX:
        lines_v = d.wrap(verdict, "S", 8.5, CW - 150)
        h = max(34, 20 + len(lines_v) * 11)
        d.ensure(h + 6)
        top = d.y
        c.setFillColor(PANEL if score >= 6 else PANEL2)
        c.setStrokeColor(LINE)
        c.setLineWidth(0.6)
        c.roundRect(ML, top - h, CW, h, 2.5, stroke=1, fill=1)
        col = ACC if score >= 7 else (ORG if score >= 5 else RED)
        c.setFillColor(col)
        c.rect(ML, top - h, 2.2, h, stroke=0, fill=1)
        c.setFont("SB", 9.4)
        c.setFillColor(TXT)
        c.drawString(ML + 12, top - 15, area)
        c.setFont("MB", 11)
        c.setFillColor(col)
        c.drawString(ML + 112, top - 15, f"{score}")
        c.setFont("M", 7)
        c.setFillColor(DIM)
        c.drawString(ML + 112 + c.stringWidth(str(score), "MB", 11) + 1, top - 15, "/10")
        # шкала
        bx, bw = ML + 12, 90
        c.setFillColor(HexColor("#131B21"))
        c.rect(bx, top - 26, bw, 3, stroke=0, fill=1)
        c.setFillColor(col)
        c.rect(bx, top - 26, bw * score / 10.0, 3, stroke=0, fill=1)
        c.setFont("M", 6.6)
        c.setFillColor(DIM)
        for i, ln in enumerate(d.wrap(checked, "M", 6.6, 96)[:3]):
            c.drawString(ML + 12, top - 36 - i * 8, ln)
        c.setFont("S", 8.5)
        c.setFillColor(MUT)
        for i, ln in enumerate(lines_v):
            c.drawString(ML + 150, top - 15 - i * 11, ln)
        d.y = top - h - 6

    d.h2("Что это значит на практике")
    d.bullets([
        "Продукт можно показывать инвестору и первым пользователям как демо — он производит впечатление законченного.",
        "Продукт нельзя отдавать пользователю как приложение: он потеряет данные (P0-3), его переписку прочитают (P0-2) и он поверит ложному обещанию приватности (P0-1).",
        "Дистанция до честного публичного релиза — 5 блокеров и примерно три недели волн 1–2; до полноценного продукта с реальным индексом файлов — ещё три недели волны 3.",
    ])


def sec_good(d):
    d.section("3", "Что уже сделано хорошо", "good",
              "Эти решения я предлагаю сохранить без изменений — они и есть капитал проекта.")
    c = d.c
    for i, (title, text) in enumerate(GOOD, 1):
        lines = d.wrap(text, "S", 8.7, CW - 46)
        h = 22 + len(lines) * 11.4
        d.ensure(h + 6)
        top = d.y
        c.setFillColor(PANEL)
        c.setStrokeColor(LINE)
        c.setLineWidth(0.6)
        c.roundRect(ML, top - h, CW, h, 2.5, stroke=1, fill=1)
        c.setFillColor(ACC)
        c.rect(ML, top - h, 2.2, h, stroke=0, fill=1)
        c.setFont("MB", 9)
        c.setFillColor(HexColor("#1E3B2E"))
        c.drawString(ML + 12, top - 15, f"{i:02d}")
        c.setFont("SB", 9.4)
        c.setFillColor(TXT)
        c.drawString(ML + 34, top - 15, title)
        c.setFont("S", 8.7)
        c.setFillColor(MUT)
        for j, ln in enumerate(lines):
            c.drawString(ML + 34, top - 29 - j * 11.4, ln)
        d.y = top - h - 6


def sec_items(d, num, title, key, sect, lead):
    d.section(num, title, key, lead)
    for it in ITEMS:
        if it["sect"] == sect:
            d.decision_card(it)


def sec_notif(d):
    d.section("5", "Уведомления: полная модель", "notif",
              "Отдельный раздел по вашему запросу. Уведомления должны быть законченной системой "
              "с явным состоянием, обратимыми действиями и понятной семантикой очистки.")
    c = d.c
    d.h2("Как это работает сейчас (факты из кода)")
    d.bullets(NOTIF_NOW, size=8.7, marker="·")

    d.h2("Дефекты текущей модели")
    for nid, prio, title, text in NOTIF_DEFECTS:
        lines = d.wrap(text, "S", 8.6, CW - 24)
        h = 26 + len(lines) * 11.2
        d.ensure(h + 6)
        top = d.y
        pc = PRIO_COLOR[prio]
        c.setFillColor(PANEL)
        c.setStrokeColor(LINE)
        c.setLineWidth(0.6)
        c.roundRect(ML, top - h, CW, h, 2.5, stroke=1, fill=1)
        c.setFillColor(pc)
        c.rect(ML, top - h, 2.2, h, stroke=0, fill=1)
        c.setFont("MB", 8.4)
        c.setFillColor(pc)
        c.drawString(ML + 12, top - 15, nid)
        c.setFont("SB", 9.2)
        c.setFillColor(TXT)
        c.drawString(ML + 46, top - 15, title)
        c.setFont("MB", 7)
        c.setFillColor(pc)
        c.drawRightString(W - MR - 12, top - 15, prio)
        c.setFont("S", 8.6)
        c.setFillColor(MUT)
        for j, ln in enumerate(lines):
            c.drawString(ML + 12, top - 30 - j * 11.2, ln)
        d.y = top - h - 6

    # таблица состояний
    d.h2("Рекомендованная модель состояний и действий")
    cols = (96, 128, CW - 96 - 128)
    d.ensure(26)
    top = d.y
    c.setFillColor(HexColor("#0F161C"))
    c.rect(ML, top - 18, CW, 18, stroke=0, fill=1)
    c.setFont("MB", 6.8)
    c.setFillColor(DIM)
    c.drawString(ML + 8, top - 12, "СОСТОЯНИЕ")
    c.drawString(ML + cols[0] + 8, top - 12, "ДЕЙСТВИЕ")
    c.drawString(ML + cols[0] + cols[1] + 8, top - 12, "ОЖИДАЕМЫЙ РЕЗУЛЬТАТ")
    d.y = top - 18
    for state, action, result in NOTIF_MODEL:
        l1 = d.wrap(state, "S", 8.2, cols[0] - 14)
        l2 = d.wrap(action, "SB", 8.2, cols[1] - 14)
        l3 = d.wrap(result, "S", 8.2, cols[2] - 14)
        h = max(len(l1), len(l2), len(l3)) * 11 + 9
        if d.y - h < MB_ + 30:
            d.new_page()
        top = d.y
        c.setStrokeColor(HexColor("#151E25"))
        c.setLineWidth(0.5)
        c.line(ML, top - h, W - MR, top - h)
        for i, ln in enumerate(l1):
            c.setFont("S", 8.2)
            c.setFillColor(MUT)
            c.drawString(ML + 8, top - 12 - i * 11, ln)
        for i, ln in enumerate(l2):
            c.setFont("SB", 8.2)
            c.setFillColor(TXT)
            c.drawString(ML + cols[0] + 8, top - 12 - i * 11, ln)
        for i, ln in enumerate(l3):
            c.setFont("S", 8.2)
            c.setFillColor(HexColor("#B9C7D2"))
            c.drawString(ML + cols[0] + cols[1] + 8, top - 12 - i * 11, ln)
        d.y = top - h

    # выбор семантики
    d.h2("Требуется ваш выбор: семантика «Очистить»", ORG)
    d.para("Отметьте один вариант — от него зависит реализация и текст в интерфейсе.", size=8.8, color=MUT)
    for code, name, text in NOTIF_DECISION["options"]:
        lines = d.wrap(text, "S", 8.6, CW - 60)
        h = 26 + len(lines) * 11.2
        d.ensure(h + 6)
        top = d.y
        col = ACC if code == "A" else MUT
        c.setFillColor(PANEL if code == "A" else PANEL2)
        c.setStrokeColor(ACC if code == "A" else LINE)
        c.setLineWidth(0.7)
        c.roundRect(ML, top - h, CW, h, 2.5, stroke=1, fill=1)
        d.radio(ML + 12, top - 22, "clear_semantics", f"variant_{code}",
                name_hint=f"Вариант {code}: {name}", selected=False)
        c.setFont("MB", 8.6)
        c.setFillColor(col)
        c.drawString(ML + 32, top - 15, code)
        c.setFont("SB", 9.2)
        c.setFillColor(TXT)
        c.drawString(ML + 48, top - 15, name)
        c.setFont("S", 8.6)
        c.setFillColor(MUT)
        for j, ln in enumerate(lines):
            c.drawString(ML + 32, top - 30 - j * 11.2, ln)
        d.y = top - h - 6

    d.h2("Критерий готовности блока уведомлений")
    d.bullets(NOTIF_DOD, size=8.7, marker="·")

    d.h2("Что я предлагаю сделать сразу, не дожидаясь остального")
    d.para(
        "Первая часть (N-1, N-2, N-3, N-5, N-7) — это несколько часов работы и она полностью "
        "меняет ощущение от продукта: раздельные действия «открыть» и «сменить статус», архив "
        "с отменой, «Очистить прочитанные» и «Очистить всё», отказ от возрождения демо-событий, "
        "счётчики по непрочитанным и синхронизация между вкладками. Остальное (retention, "
        "виртуализация, журнал безопасности) идёт волнами 1–2.", size=9, lead=12.6)
    d.ensure(40)
    top = d.y
    c.setFillColor(HexColor("#0C1512"))
    c.setStrokeColor(ACC)
    c.setLineWidth(0.7)
    c.roundRect(ML, top - 34, CW, 34, 3, stroke=1, fill=1)
    d.checkbox(ML + 12, top - 23, "notif_now_approve", tip="Утвердить немедленную реализацию блока N-1…N-7")
    c.setFont("SB", 9.2)
    c.setFillColor(TXT)
    c.drawString(ML + 32, top - 15, "Утверждаю немедленную реализацию N-1, N-2, N-3, N-5, N-7")
    c.setFont("S", 8.2)
    c.setFillColor(MUT)
    c.drawString(ML + 32, top - 27, "остальные пункты уведомлений — в составе волн 1–2")
    d.y = top - 40


def sec_proto(d):
    d.section("11", "Прототип vs приложение", "proto",
              "Симптомы prototype-driven development, найденные в проекте, и пункты, которые их закрывают.")
    c = d.c
    d.ensure(24)
    top = d.y
    c.setFillColor(HexColor("#0F161C"))
    c.rect(ML, top - 18, CW, 18, stroke=0, fill=1)
    c.setFont("MB", 6.8)
    c.setFillColor(DIM)
    c.drawString(ML + 8, top - 12, "СИМПТОМ")
    c.drawString(ML + 150, top - 12, "ЧТО ИМЕННО НАЙДЕНО")
    c.drawRightString(W - MR - 8, top - 12, "ЗАКРЫВАЕТСЯ")
    d.y = top - 18
    for sign, found, fixes in PROTO_SIGNS:
        l1 = d.wrap(sign, "SB", 8.4, 136)
        l2 = d.wrap(found, "S", 8.4, CW - 150 - 96)
        h = max(len(l1), len(l2)) * 11 + 10
        if d.y - h < MB_ + 30:
            d.new_page()
        top = d.y
        c.setStrokeColor(HexColor("#151E25"))
        c.setLineWidth(0.5)
        c.line(ML, top - h, W - MR, top - h)
        for i, ln in enumerate(l1):
            c.setFont("SB", 8.4)
            c.setFillColor(TXT)
            c.drawString(ML + 8, top - 13 - i * 11, ln)
        for i, ln in enumerate(l2):
            c.setFont("S", 8.4)
            c.setFillColor(MUT)
            c.drawString(ML + 150, top - 13 - i * 11, ln)
        c.setFont("M", 7.4)
        c.setFillColor(ACC)
        c.drawRightString(W - MR - 8, top - 13, fixes)
        d.y = top - h
    d.y -= 10
    d.h2("Формула готовности")
    d.para("Production-ready = функциональность + надёжность + безопасность + понятная логика + "
           "наблюдаемость + тестируемость + возможность развития.", font="SB", size=10, color=ACC)
    d.para("Сегодня у проекта закрыты первый и (частично) четвёртый слагаемые. Волны 1–2 закрывают "
           "безопасность, надёжность, наблюдаемость и тестируемость; волна 3 — функциональность ядра.",
           size=9, color=MUT)


def sec_check(d):
    d.section("12", "Production checklist", "check",
              "Обязательное до публичного релиза. Чекбоксы интерактивные — можно вести как рабочий трекер.")
    c = d.c
    group = None
    for grp, text in CHECKLIST:
        if grp != group:
            group = grp
            d.label(grp, ACC, size=7.4)
            d.y -= 2
        d.ensure(18)
        d.y -= 15
        d.checkbox(ML, d.y - 2, f"chk_{grp}_{text[:18]}", tip=text, size=9)
        c.setFont("S", 8.9)
        c.setFillColor(HexColor("#C9D6E0"))
        c.drawString(ML + 16, d.y, text)
    d.y -= 8


def sec_road(d):
    d.section("13", "Приоритизированный roadmap", "road",
              "Порядок выполнения P0 → P3. Оценки — для одного разработчика, включая тесты.")
    c = d.c
    for name, prio, est, content, result in ROADMAP:
        lc = d.wrap(content, "S", 8.5, CW - 24)
        lr = d.wrap(result, "SB", 8.6, CW - 24)
        h = 40 + len(lc) * 11.2 + len(lr) * 11.4
        d.ensure(h + 8)
        top = d.y
        col = PRIO_COLOR[prio.split("–")[0]]
        c.setFillColor(PANEL)
        c.setStrokeColor(LINE)
        c.setLineWidth(0.7)
        c.roundRect(ML, top - h, CW, h, 3, stroke=1, fill=1)
        c.setFillColor(col)
        c.rect(ML, top - h, 2.4, h, stroke=0, fill=1)
        c.setFont("SB", 10.4)
        c.setFillColor(TXT)
        c.drawString(ML + 12, top - 17, name)
        pw = d.pill(W - MR - 12 - 46, top - 21, prio, col)
        c.setFont("M", 7.4)
        c.setFillColor(DIM)
        c.drawRightString(W - MR - 12 - 46 - pw + 42, top - 17, est)
        c.setFont("MB", 6.4)
        c.setFillColor(DIM)
        c.drawString(ML + 12, top - 32, "СОСТАВ")
        yy = top - 32
        c.setFont("S", 8.5)
        c.setFillColor(MUT)
        for ln in lc:
            yy -= 11.2
            c.drawString(ML + 12, yy, ln)
        yy -= 6
        c.setFont("MB", 6.4)
        c.setFillColor(ACC)
        c.drawString(ML + 12, yy, "РЕЗУЛЬТАТ ВОЛНЫ")
        for ln in lr:
            yy -= 11.4
            c.setFont("SB", 8.6)
            c.setFillColor(HexColor("#CFE3D8"))
            c.drawString(ML + 12, yy, ln)
        d.y = top - h - 8

    d.h2("Что я НЕ рекомендую делать сейчас")
    d.bullets([
        "Переписывать дизайн-систему или экраны: они и так лучшая часть продукта.",
        "Начинать с E2EE-синхронизации и MCP-сервера: без данных и безопасности это красивая надстройка над ненадёжным фундаментом.",
        "Вводить роли и permissions: продукт однопользовательский по смыслу, достаточно закрыть серверную часть и зафиксировать контракт «одно устройство — один владелец».",
        "Заводить микросервисы или отдельный backend: Next.js route handlers + IndexedDB закрывают все сценарии этого продукта.",
    ])


def sec_sign(d):
    d.section("14", "Лист утверждения и подпись", "sign",
              "Контрольная точка перед началом работ. Заполняется прямо в файле.")
    c = d.c
    for group, rows in APPROVAL:
        d.label(group, ACC, size=7.4)
        for r in rows:
            d.ensure(20)
            d.y -= 16
            d.checkbox(ML, d.y - 2, f"ap_{group}_{r[:16]}", tip=f"{group}: {r}")
            c.setFont("S", 9)
            c.setFillColor(HexColor("#C9D6E0"))
            c.drawString(ML + 16, d.y, r)
    d.y -= 12

    d.h2("Примечания и решения владельца продукта")
    d.ensure(90)
    d.y -= 4
    d.textfield(ML, d.y - 74, CW, 74, "owner_notes",
                tip="Примечания, приоритеты, ограничения, сроки", multiline=True, size=9)
    d.y -= 84

    d.h2("Утверждение")
    d.ensure(90)
    top = d.y
    c.setFillColor(PANEL)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.roundRect(ML, top - 84, CW, 84, 3, stroke=1, fill=1)
    half = (CW - 36) / 2
    c.setFont("MB", 6.6)
    c.setFillColor(DIM)
    c.drawString(ML + 12, top - 20, "ИМЯ / РОЛЬ")
    d.textfield(ML + 12, top - 42, half, 16, "sign_name", tip="Имя и роль")
    c.setFont("MB", 6.6)
    c.setFillColor(DIM)
    c.drawString(ML + 24 + half, top - 20, "ДАТА")
    d.textfield(ML + 24 + half, top - 42, half, 16, "sign_date", tip="Дата утверждения")
    c.setFont("MB", 6.6)
    c.setFillColor(DIM)
    c.drawString(ML + 12, top - 56, "ПОДПИСЬ / ФОРМУЛИРОВКА УТВЕРЖДЕНИЯ")
    d.textfield(ML + 12, top - 78, CW - 24, 18, "sign_value",
                tip="Например: утверждаю волну 1 и вариант A по уведомлениям")
    d.y = top - 94

    d.ensure(62)
    top = d.y
    c.setFillColor(HexColor("#0C1512"))
    c.setStrokeColor(ACC)
    c.setLineWidth(0.8)
    c.roundRect(ML, top - 56, CW, 56, 3, stroke=1, fill=1)
    c.setFont("MB", 7)
    c.setFillColor(ACC)
    c.drawString(ML + 14, top - 16, "ПОСЛЕ УТВЕРЖДЕНИЯ")
    c.setFont("S", 8.8)
    c.setFillColor(MUT)
    for i, ln in enumerate(d.wrap(
        "Реализация идёт волнами: сначала P0, затем P1. Концепция не меняется без вашего решения; "
        "для спорных мест выбирается вариант, сохраняющий текущую функциональность. После каждой "
        "волны — прогон типов, линта, тестов и ключевых сценариев.",
            "S", 8.8, CW - 28)):
        c.drawString(ML + 14, top - 30 - i * 11, ln)
    d.y = top - 62


def build(path, pages=None):
    d = Doc(path, pages)
    cover(d)
    toc(d)
    sec_howto(d)
    sec_exec(d)
    sec_good(d)
    sec_items(d, "4", "Критические проблемы · P0", "crit", "crit",
              "Пять блокеров. Без них продукт нельзя отдавать пользователям, даже если всё остальное красиво.")
    sec_notif(d)
    sec_items(d, "6", "UX / UI изменения", "ux", "ux",
              "Точечные изменения экранов и взаимодействий. Дизайн-система не меняется.")
    sec_items(d, "7", "Изменения логики", "logic", "logic",
              "Состояния, правила и сценарии, которые сегодня работают только на happy path.")
    sec_items(d, "8", "Архитектурные изменения", "arch", "arch",
              "Технические переработки с обоснованием. Ни одна не требует переписывания продукта.")
    sec_items(d, "9", "Убрать · объединить · изменить", "remove", "remove",
              "Удаляется только мёртвый код и то, что вводит пользователя в заблуждение.")
    sec_items(d, "10", "Новые функции", "feat", "feat",
              "Только обоснованные функции, усиливающие основной сценарий: локальный сейф с ИИ.")
    sec_proto(d)
    sec_check(d)
    sec_road(d)
    sec_sign(d)
    d.save()
    return d.pagemap


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "/app/public/WorkfloW-Audit-2026-06.pdf"
    pm = build("/tmp/_pass1.pdf")          # первый проход: собираем номера страниц
    build(out, pm)                          # второй проход: с оглавлением
    print("OK", out, "pages:", max(pm.values()))
