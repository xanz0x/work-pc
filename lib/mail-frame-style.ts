/** Стили отправителя не должны отключать прокрутку документа просмотрщика.
 * Вставляется ПОСЛЕ тела письма: меняем только корневую область, не трогая
 * скрытые preheader-блоки, таблицы, картинки и оформление самого письма. */
export const MAIL_FRAME_SCROLL_STYLE = `<style data-wsx-mail-scroll>
html:root {
  overflow: auto !important;
  height: auto !important;
  min-height: 100% !important;
  max-height: none !important;
}
html:root > body {
  overflow: visible !important;
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
}
</style>`