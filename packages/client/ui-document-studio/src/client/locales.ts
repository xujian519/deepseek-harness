/** `documentStudio` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'documentStudio'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'view.document': '交付物',
  'studio.empty': '本会话还没有交付文件。让文档智能体生成 HTML / 文档 / Deck 后，产物会出现在这里。',
  'studio.files': '{count} 个交付文件',
  'studio.preview': '预览',
  'studio.preview.hint': '选择上方文件预览（HTML / 文本）。',
  'studio.preview.truncated': '（文件较大，仅显示开头部分）',
  'studio.preview.error': '无法读取文件：{message}',
  'studio.action.open': '打开',
  'studio.action.folder': '在文件夹中显示',
  'studio.action.print': '打印 / 导出 PDF',
  'studio.section.html': 'HTML / 网页',
  'studio.section.document': '文档与数据',
  'studio.print.note': '在打印对话框中选择「另存为 PDF」即可导出。',
}

/** English dictionary (same key set). */
export const en: Record<DocumentStudioKey, string> = {
  'view.document': 'Deliverables',
  'studio.empty': 'This session has no delivered files yet. Files produced by the document agent appear here.',
  'studio.files': '{count} delivered files',
  'studio.preview': 'Preview',
  'studio.preview.hint': 'Select a file above to preview (HTML / text).',
  'studio.preview.truncated': '（large file, showing the head only）',
  'studio.preview.error': 'Cannot read file: {message}',
  'studio.action.open': 'Open',
  'studio.action.folder': 'Show in folder',
  'studio.action.print': 'Print / Export PDF',
  'studio.section.html': 'HTML / Web',
  'studio.section.document': 'Documents & data',
  'studio.print.note': 'Choose “Save as PDF” in the print dialog to export.',
}

/** Union of this namespace's dictionary keys. */
export type DocumentStudioKey = keyof typeof zh
