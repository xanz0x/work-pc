import Image from 'next/image'

/** Одобренный логотип: полная версия для форм, надпись для пары со знаком. */
export function LogoWord({
  className,
  withMark = true,
  testId,
}: {
  className?: string
  withMark?: boolean
  testId: string
}) {
  return (
    <Image
      className={`workspace-logo ${withMark ? 'workspace-logo-full' : 'workspace-logo-word'}${className ? ` ${className}` : ''}`}
      src={withMark ? '/brand/workspacex-logo.png' : '/brand/workspacex-wordmark.png'}
      alt="WorkSpaceX"
      width={withMark ? 930 : 646}
      height={withMark ? 144 : 112}
      data-testid={testId}
      unoptimized
      loading="eager"
      draggable={false}
    />
  )
}
