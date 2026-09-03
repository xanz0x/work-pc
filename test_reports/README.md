# test_reports/ — отчёты приёмки

- `iteration_N.json` — отчёты тестировщика по волнам. На верхнем уровне лежат
  три последних; всё, что старше, — в `archive/` (история не удаляется).
- `pytest/*.xml` — junit-выгрузки прогонов `python3 -m pytest tests/api`.
- Артефакты Playwright (`test-results/`, `playwright-report/`) в репозиторий не
  попадают: они перегенерируются прогоном и лежат под `.gitignore`.
