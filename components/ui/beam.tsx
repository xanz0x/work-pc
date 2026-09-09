'use client'

/**
 * Луч на границе — порт Magic UI BorderBeam на чистый CSS, без motion.
 * Родителю нужен position: relative (у .panel-карточек он уже есть,
 * остальным помогает класс .beam-host). Луч — это волосяная кромка,
 * по которой бежит акцентная точка: глубина по-прежнему тоном,
 * не тенью и не свечением. prefers-reduced-motion гасит бег глобально.
 */
export function Beam({
  duration = 4.2,
  size = 40,
}: {
  /** Полный круг по периметру, секунд. */
  duration?: number
  /** Хвост точки, px. */
  size?: number
}) {
  return (
    <span
      aria-hidden="true"
      className="beam"
      style={{
        ['--beam-dur' as string]: `${duration}s`,
        ['--beam-size' as string]: `${size}px`,
      }}
    />
  )
}
