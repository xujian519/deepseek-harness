/**
 * The ledger's cell-kind vocabulary: the locale key and the icon glyph each kind renders with.
 */

import type { ReactNode } from 'react'
import {
  IconSettingsOutlineRegular,
  IconSparkleRegular,
  IconUserOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TrajectoryCellKind } from './trajectory-record.ts'
import type { TrajectoryKey } from './locales.ts'

function ToolWrenchIcon(): ReactNode {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-role-icon="wrench"
      aria-hidden="true"
    >
      <path d="M14 3.3a3.8 3.8 0 0 1-4.8 4.8l-5.1 5.1a1.6 1.6 0 1 1-2.3-2.3l5.1-5.1A3.8 3.8 0 0 1 11.7 1l-2.3 2.3 2.3 2.3L14 3.3Z" />
    </svg>
  )
}

function InformationIcon(): ReactNode {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      data-role-icon="information"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.7" />
      <circle cx="8" cy="5.5" r=".85" fill="currentColor" stroke="none" />
      <path d="M8 7.75v3.4" strokeWidth="1.8" />
    </svg>
  )
}

function CompactedIcon(): ReactNode {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-role-icon="compacted"
      aria-hidden="true"
    >
      <path d="m2.5 2.5 3.75 3.75M3 6.25h3.25V3" />
      <path d="m13.5 2.5-3.75 3.75M13 6.25H9.75V3" />
      <path d="m2.5 13.5 3.75-3.75M3 9.75h3.25V13" />
      <path d="m13.5 13.5-3.75-3.75M13 9.75H9.75V13" />
    </svg>
  )
}

/** Locale key naming each ledger cell kind. */
export const KIND_LABEL_KEY: Record<TrajectoryCellKind, TrajectoryKey> = {
  system: 'kind.system',
  user: 'kind.user',
  context: 'kind.context',
  compacted: 'kind.compacted',
  message: 'kind.assistant',
  tool: 'kind.tool',
  subtool: 'kind.subtool',
}

/** Icon glyph rendering each ledger cell kind. */
export const KIND_ICON: Record<TrajectoryCellKind, ReactNode> = {
  system: <IconSettingsOutlineRegular size={13} />,
  user: <IconUserOutlineRegular size={13} />,
  context: <InformationIcon />,
  compacted: <CompactedIcon />,
  message: <IconSparkleRegular size={13} />,
  tool: <ToolWrenchIcon />,
  subtool: <ToolWrenchIcon />,
}
