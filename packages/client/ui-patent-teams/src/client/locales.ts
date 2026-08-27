/** `patentTeams` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'patentTeams'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'view.teams': '团队',
  'view.empty': '本会话暂无团队记录。在专利模式下让模型使用 PatentTeams 组建团队后，团队进展会显示在这里。',
  'card.members': '{count} 名成员',
  'card.tasks': '{done}/{total} 项任务',
  'card.messages': '{count} 条消息',
  'card.noTasks': '暂无任务',
  'status.active': '进行中',
  'status.completed': '全部完成',
  'status.deleted': '已解散',
  'member.open': '打开 {name}',
  'member.removed': '已离队',
  'member.idle': '待命',
  'member.running': '执行中',
  'task.pending': '待领取',
  'task.claimed': '已认领',
  'task.in_progress': '进行中',
  'task.completed': '已完成',
  'task.failed': '失败',
  'task.cancelled': '已取消',
  'task.unknownStatus': '{status}',
  'task.noStatus': '未开始',
  'task.unassigned': '未分配',
  'task.deps': '依赖 {deps}',
  'task.contractDegraded': '契约缺字段：{fields}',
  'task.gated': '未过质量门',
  'section.members': '成员',
  'section.tasks': '任务',
}

/** English dictionary (same key set). */
export const en: Record<PatentTeamsKey, string> = {
  'view.teams': 'Teams',
  'view.empty': 'No team records in this session yet. Start a patent-mode session and have the model run PatentTeams; team progress will appear here.',
  'card.members': '{count} members',
  'card.tasks': '{done}/{total} tasks',
  'card.messages': '{count} messages',
  'card.noTasks': 'No tasks yet',
  'status.active': 'Active',
  'status.completed': 'All done',
  'status.deleted': 'Disbanded',
  'member.open': 'Open {name}',
  'member.removed': 'Left',
  'member.idle': 'Idle',
  'member.running': 'Working',
  'task.pending': 'Pending',
  'task.claimed': 'Claimed',
  'task.in_progress': 'In progress',
  'task.completed': 'Completed',
  'task.failed': 'Failed',
  'task.cancelled': 'Cancelled',
  'task.unknownStatus': '{status}',
  'task.noStatus': 'Not started',
  'task.unassigned': 'Unassigned',
  'task.deps': 'Depends on {deps}',
  'task.contractDegraded': 'Contract missing: {fields}',
  'task.gated': 'Gate rejected',
  'section.members': 'Members',
  'section.tasks': 'Tasks',
}

/** Union of this namespace's dictionary keys. */
export type PatentTeamsKey = keyof typeof zh
