/** Скелет загрузки экрана (UX-2, шаг 3); пригодится code splitting из AR-2. */
export default function Loading() {
  return (
    <div className="skeleton-screen" aria-busy="true" data-testid="screen-loading">
      <div className="skeleton-row w-40" />
      <div className="skeleton-row tall" />
      <div className="skeleton-row w-70" />
      <div className="skeleton-row w-40" />
    </div>
  )
}
