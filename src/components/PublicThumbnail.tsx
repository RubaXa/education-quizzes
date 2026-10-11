import EducationImage from './EducationImage'

/**
 * Совместимость со старыми вызовами; единый компонент управляет загрузкой.
 * @see ../../docs/product/design-system.md#images
 */
export default function PublicThumbnail({ url, alt, size = 'S', retryControl = false, fit = 'cover' }: { url: string; alt: string; size?: 'S' | 'M' | 'XXXL'; retryControl?: boolean; fit?: 'cover' | 'contain' }) {
  return <EducationImage source={url} mode="public" size={size} alt={alt} fit={fit} compact retryControl={retryControl} />
}
