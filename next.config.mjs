/** @type {import('next').NextConfig} */
import withBundleAnalyzer from '@next/bundle-analyzer'

const nextConfig = {
  devIndicators: false,
  // P0-4: сборка обязана падать на ошибке типов — гейт, а не пожелание.
  images: {
    unoptimized: true,
  },
  // Dev-ресурсы запрашиваются с 127.0.0.1 — без этого Next 16 блокирует
  // отдачу чанков (страница выглядит «мёртвой»: HTML есть, JS не грузится).
  allowedDevOrigins: [
    '127.0.0.1',
    'localhost',
    '52b9c083-0250-4c85-930b-cff2191de938.preview.emergentagent.com',
    '*.preview.emergentagent.com',
    '.preview.emergentagent.com',
    '*.preview.emergentcf.cloud',
    '*.cluster-5.preview.emergentcf.cloud',
    '.preview.emergentcf.cloud',
  ],
}

export default withBundleAnalyzer({
  // AR-2: карта бандла снимается по требованию — `ANALYZE=true pnpm build`.
  // Замер, который попадает в PRD, делает scripts/bundle-report.mjs: он
  // считает то, что реально грузит браузер на маршруте.
  enabled: process.env.ANALYZE === 'true',
})(nextConfig)
