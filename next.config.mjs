/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
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

export default nextConfig
