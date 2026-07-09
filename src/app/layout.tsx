import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'MesaManager — Gestión de Sala',
  description: 'Sistema profesional de gestión de reservas y planta de sala para restaurantes y bares',
  keywords: ['restaurante', 'reservas', 'gestión de sala', 'hostelería', 'mesas'],
  authors: [{ name: 'MesaManager' }],
  robots: 'noindex', // App privada
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1, // Prevenir zoom accidental en tablets
  userScalable: false,
  themeColor: '#0b0f19',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body className="antialiased">
        {children}
        <Toaster
          position="top-right"
          theme="dark"
          toastOptions={{
            style: {
              background: '#1e293b',
              border: '1px solid #334155',
              color: '#f1f5f9',
              fontFamily: 'Inter, sans-serif',
            },
          }}
        />
      </body>
    </html>
  );
}
