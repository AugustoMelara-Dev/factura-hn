import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { z } from 'astro/zod';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    // `fuente`: archivo del repositorio del que sale una página generada (el pie la enlaza en GitHub).
    schema: docsSchema({ extend: z.object({ fuente: z.string().optional() }) }),
  }),
};
