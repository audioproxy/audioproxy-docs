// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.audioproxy.dev',
  integrations: [
    starlight({
      title: 'audioproxy',
      logo: {
        light: './src/assets/mark-mixdown-light.svg',
        dark: './src/assets/mark-mixdown-dark.svg',
        alt: 'audioproxy',
      },
      favicon: '/favicon.svg',
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://docs.audioproxy.dev/og.png' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://docs.audioproxy.dev/og.png' } },
        // Privacy-friendly analytics by Plausible
        {
          tag: 'script',
          attrs: { async: true, src: 'https://plausible.io/js/pa-1tE80iqRDeoqTKahlxCod.js' },
        },
        {
          tag: 'script',
          content:
            'window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()',
        },
      ],
      customCss: [
        '@fontsource/bricolage-grotesque/400.css',
        '@fontsource/bricolage-grotesque/500.css',
        '@fontsource/bricolage-grotesque/600.css',
        '@fontsource/bricolage-grotesque/700.css',
        '@fontsource/monaspace-xenon/800.css',
        '@fontsource/monaspace-neon/400.css',
        '@fontsource/monaspace-neon/700.css',
        './src/styles/brand.css',
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/audioproxy/audioproxy' },
      ],
      sidebar: [
        { label: 'Start here', items: [{ label: 'Quickstart', slug: 'start/quickstart' }] },
        {
          label: 'Guides',
          items: [
            { label: 'Transforms', slug: 'guides/transforms' },
              { label: 'Sources', slug: 'guides/sources' },
            { label: 'Rendering', slug: 'guides/rendering' },
            { label: 'Playback analytics', slug: 'guides/playback-analytics' },
            { label: 'S3 providers', slug: 'guides/s3-providers' },
            { label: 'Scaling', slug: 'guides/scaling' },
            { label: 'Capacity planning', slug: 'guides/capacity' },
          ],
        },
        {
          label: 'Integrations',
          items: [
            { label: 'Rails', slug: 'integrations/rails' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'API contract (v1)', slug: 'reference/api-v1' },
            { label: 'Module docs (hexdocs)', link: 'https://hexdocs.pm/audio_proxy' },
            { label: 'llms.txt', link: 'https://github.com/audioproxy/audioproxy/blob/main/llms.txt' },
            ],
          },
          {
            label: 'Project',
            items: [
              { label: 'Contributing', link: 'https://github.com/audioproxy/audioproxy/blob/main/docs/development.md' },
              { label: 'ffmpeg internals', link: 'https://github.com/audioproxy/audioproxy/blob/main/docs/ffmpeg-arguments.md' },
          ],
        },
      ],
    }),
  ],
});
