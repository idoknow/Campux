import { useState } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { Navbar } from '@/components/campux/Navbar';
import { HeroSection } from '@/components/campux/HeroSection';
import { WhySection } from '@/components/campux/WhySection';
import { FeaturesSection } from '@/components/campux/FeaturesSection';
import { ShowcaseSection } from '@/components/campux/ShowcaseSection';
import { DocsSection } from '@/components/campux/DocsSection';
import { CommunitySection } from '@/components/campux/CommunitySection';
import { CtaBanner } from '@/components/campux/CtaBanner';
import { Footer } from '@/components/campux/Footer';
import { Lightbox } from '@/components/campux/Lightbox';

/** Campux 官网首页（单页落地页） */
export default function HomePage() {
  // 全站主题状态统一在这里维护，Navbar 内部再切一次会导致状态不同步
  const { theme, toggleTheme } = useTheme();
  const [lightbox, setLightbox] = useState<{ src: string; title: string } | null>(null);

  const openLightbox = (src: string, title: string) => setLightbox({ src, title });
  const closeLightbox = () => setLightbox(null);

  return (
    <div className="relative min-h-screen w-full overflow-x-clip">
      <Navbar theme={theme} onToggleTheme={toggleTheme} />
      <main className="flex-1">
        <HeroSection onImageClick={openLightbox} />
        <WhySection />
        <FeaturesSection onImageClick={openLightbox} />
        <ShowcaseSection onImageClick={openLightbox} />
        <DocsSection />
        <CommunitySection />
        <CtaBanner />
      </main>
      <Footer />

      {lightbox && (
        <Lightbox
          open
          src={lightbox.src}
          title={lightbox.title}
          onClose={closeLightbox}
        />
      )}
    </div>
  );
}
