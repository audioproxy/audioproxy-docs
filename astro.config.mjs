// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://audioproxy-docs.netlify.app',
  integrations: [
    starlight({
      title: 'audioproxy',
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
