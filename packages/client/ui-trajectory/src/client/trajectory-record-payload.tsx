/**
 * Raw payload view of one record: its JSON containers, tool schema, and the request options tree.
 */

import { JsonTree, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { JsonTreeProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AssistantRequestConfig, RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TrajectorySourceBlock } from './trajectory-record.ts'
import type { TrajectoryTranslate } from './locales.ts'
import css from './TrajectoryTable.module.css'
import type { TableRecord } from '../types.ts'
import { jsonTreeLabels, markdownLabels } from '../types.ts'

export function RequestOptions({
  options,
  preview = false,
  stringWrapping,
  t,
}: {
  options: AssistantRequestConfig | undefined
  preview?: boolean
  stringWrapping: JsonTreeProps['stringWrapping']
  t: TrajectoryTranslate
}) {
  if (options === undefined) {
    return <p className={css.noPayload}>{t('options.notRecorded')}</p>
  }
  return (
    <JsonTree
      data={options}
      stringWrapping={stringWrapping}
      collapsedStringLines={preview ? 3 : 12}
      label={t('options.json')}
      labels={jsonTreeLabels(t)}
      className={preview ? css.jsonPreview : css.jsonPayload}
    />
  )
}

function ToolOutputBlocks({
  blocks,
  error,
  errorDetail,
  preview,
  renderImages,
}: {
  blocks: readonly TrajectorySourceBlock[]
  error: boolean
  /** Failure name and code preserved beside image-only error content. */
  errorDetail?: string | undefined
  preview: boolean
  renderImages: RenderMessageImages
}) {
  return (
    <div className={[
      css.resultBlocks,
      preview ? css.resultBlocksPreview : undefined,
      error ? css.errorPayload : undefined,
    ].filter((value): value is string => value !== undefined).join(' ')}
    >
      {error && errorDetail !== undefined && errorDetail !== ''
        && <pre className={css.resultBlockText}>{errorDetail}</pre>}
      {blocks.map((block, index) => (
        block.attachment !== undefined
          ? (
            <div className={css.messageImages} key={index}>
              {renderImages({ images: [{ attachment: block.attachment }], align: 'start' })}
            </div>
          )
          : block.content !== ''
            ? <pre className={css.resultBlockText} key={index}>{block.content}</pre>
            : null
      ))}
    </div>
  )
}

export function RecordPayload({
  record,
  direction,
  preview = false,
  renderImages,
  stringWrapping,
  t,
}: {
  record: TableRecord
  direction: 'input' | 'output'
  preview?: boolean
  renderImages: RenderMessageImages
  stringWrapping: JsonTreeProps['stringWrapping']
  t: TrajectoryTranslate
}) {
  const value = direction === 'input' ? record.cell.inputDetail : record.cell.outputDetail
  const missing = direction === 'input'
    ? t('record.noPayload')
    : t('record.noResult')
  if (!value) return <p className={css.noPayload}>{missing}</p>
  const error = direction === 'output' && record.cell.isError === true
  const payloadClass = preview ? css.jsonPreview : css.jsonPayload
  const payloadClassName = error ? `${payloadClass} ${css.errorPayload}` : payloadClass

  const json = parseJsonContainer(value)
  const singleTextResult = direction === 'output'
    && record.cell.outputBlocks?.length === 1
    && record.cell.outputBlocks[0]?.type === 'text'
  if (singleTextResult && json !== undefined) {
    return (
      <JsonTree
        data={json}
        stringWrapping={stringWrapping}
        collapsedStringLines={preview ? 3 : 12}
        label={t('record.resultJson')}
        labels={jsonTreeLabels(t)}
        className={payloadClassName}
      />
    )
  }

  if (
    direction === 'output'
    && record.cell.outputBlocks?.some(block =>
      block.attachment !== undefined || block.content !== '') === true
  ) {
    return (
      <ToolOutputBlocks
        blocks={record.cell.outputBlocks}
        error={error}
        errorDetail={error ? value : undefined}
        preview={preview}
        renderImages={renderImages}
      />
    )
  }

  const markdown = (
    direction === 'input'
    && (record.cell.kind === 'user' || record.cell.kind === 'context')
  ) || (
    direction === 'output' && record.cell.kind === 'message'
  )
  if (markdown) {
    return (
      <div className={[
        preview ? css.markdownPreview : css.markdownPayload,
        error ? css.errorPayload : undefined,
      ].filter((className): className is string => className !== undefined).join(' ')}
      >
        <MarkdownText text={value} labels={markdownLabels(t)} />
      </div>
    )
  }
  if (json !== undefined) {
    return (
      <JsonTree
        data={json}
        stringWrapping={stringWrapping}
        collapsedStringLines={preview ? 3 : 12}
        label={t(direction === 'input' ? 'record.payloadJson' : 'record.outputJson')}
        labels={jsonTreeLabels(t)}
        className={payloadClassName}
      />
    )
  }
  return (
    <pre className={[
      css.payload,
      preview ? css.payloadPreview : undefined,
      error ? css.errorPayload : undefined,
      value === t('record.noOutput') ? css.noOutputText : undefined,
    ].filter((value): value is string => value !== undefined).join(' ')}
    >
      {value}
    </pre>
  )
}

export function RecordSchema({
  record,
  preview = false,
  stringWrapping,
  t,
}: {
  record: TableRecord
  preview?: boolean
  stringWrapping: JsonTreeProps['stringWrapping']
  t: TrajectoryTranslate
}) {
  if (!record.cell.schemaDetail) {
    return <p className={css.noPayload}>{t('record.schemaUnavailable')}</p>
  }
  const schema = parseToolSchema(record.cell.schemaDetail)
  if (schema !== undefined) {
    return (
      <div className={preview ? `${css.schema} ${css.schemaPreview}` : css.schema}>
        <header className={css.schemaIntro}>
          <h3 className={css.schemaName}>{schema.name}</h3>
          <p className={css.schemaDescription}>{schema.description}</p>
        </header>
        <section className={css.schemaParameters}>
          <h4 className={css.schemaParametersTitle}>{t('record.parameters')}</h4>
          <JsonTree
            data={schema.parameters}
            stringWrapping={stringWrapping}
            collapsedStringLines={preview ? 3 : 12}
            label={t('record.namedParametersJson', { name: schema.name })}
            labels={jsonTreeLabels(t)}
            className={css.schemaTree}
          />
        </section>
      </div>
    )
  }
  return (
    <pre className={`${css.payload} ${preview ? css.payloadPreview : ''}`}>
      {record.cell.schemaDetail}
    </pre>
  )
}

interface ParsedToolSchema {
  name: string
  description: string
  parameters: object
}

function parseToolSchema(value: string): ParsedToolSchema | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const schema = parsed as Record<string, unknown>
    if (
      typeof schema.name !== 'string'
      || typeof schema.description !== 'string'
      || typeof schema.parameters !== 'object'
      || schema.parameters === null
      || Array.isArray(schema.parameters)
    ) return undefined
    return {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    }
  } catch {
    return undefined
  }
}

/**
 * Parse one recorded payload that may carry a JSON container.
 * @param value - Recorded payload text.
 * @returns The parsed container, or undefined for a scalar or malformed payload.
 */
export function parseJsonContainer(value: string): object | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}
