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
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
}

export default nextConfig
