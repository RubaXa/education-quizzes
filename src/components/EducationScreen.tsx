import type { ReactNode } from 'react'
import type { ScreenBlock, ScreenBlockType, ScreenManifest } from '@/lib/educationSchema'

export type ScreenRenderers = Record<ScreenBlockType, (block: ScreenBlock) => ReactNode>

/**
 * Порядок, наличие и подписи секций приходят из Firestore-манифеста.
 * Каждый тип исполняется только через зарегистрированный React-компонент.
 * @see ../../docs/architecture/backend-driven-ui.md#rendering
 */
export function EducationScreen({ manifest, renderers }: { manifest: ScreenManifest; renderers: ScreenRenderers }) {
  return <main data-screen-revision={manifest.revision}>
    {manifest.blocks.filter((block) => block.visible !== false).map((block) =>
      <section key={block.id} data-block-type={block.type} aria-labelledby={`education-block-${block.id}`}>
        <h2 id={`education-block-${block.id}`}>{block.title}</h2>
        {renderers[block.type](block)}
      </section>,
    )}
  </main>
}
