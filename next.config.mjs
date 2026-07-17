/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['postgres', '@electric-sql/pglite', 'bcryptjs', 'nodemailer'],
};
export default nextConfig;
