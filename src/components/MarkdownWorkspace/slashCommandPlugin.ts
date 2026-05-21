import { CompletionContext, CompletionResult } from '@codemirror/autocomplete'

export const slashCommands = [
  { label: '/h1', displayLabel: '标题 1', type: 'keyword', apply: '# ', detail: '大标题' },
  { label: '/h2', displayLabel: '标题 2', type: 'keyword', apply: '## ', detail: '中标题' },
  { label: '/h3', displayLabel: '标题 3', type: 'keyword', apply: '### ', detail: '小标题' },
  { label: '/bold', displayLabel: '粗体', type: 'keyword', apply: '**粗体**', detail: '加粗文本' },
  { label: '/italic', displayLabel: '斜体', type: 'keyword', apply: '*斜体*', detail: '倾斜文本' },
  { label: '/quote', displayLabel: '引用', type: 'keyword', apply: '> ', detail: '引用块' },
  { label: '/code', displayLabel: '代码块', type: 'keyword', apply: '```\n\n```', detail: '插入代码' },
  { label: '/table', displayLabel: '表格', type: 'keyword', apply: '| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |', detail: '插入表格' },
  { label: '/todo', displayLabel: '待办', type: 'keyword', apply: '- [ ] ', detail: '待办事项' },
  { label: '/list', displayLabel: '无序列表', type: 'keyword', apply: '- ', detail: '项目符号' },
  { label: '/numlist', displayLabel: '有序列表', type: 'keyword', apply: '1. ', detail: '数字列表' },
  { label: '/divider', displayLabel: '分割线', type: 'keyword', apply: '\n---\n', detail: '水平线' },
]

export function slashCommandCompletion(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/\/\w*/)
  if (!word) return null
  if (word.from === word.to && !context.explicit) return null

  return {
    from: word.from,
    options: slashCommands
      .filter(cmd => cmd.label.startsWith(word.text))
      .map(cmd => ({
        label: cmd.label,
        displayLabel: cmd.displayLabel,
        type: cmd.type,
        info: cmd.detail,
        // When user selects a command, replace the slash command text with the target markup
        apply: (view, completion, from, to) => {
          view.dispatch({
            changes: { from, to, insert: cmd.apply },
            selection: { anchor: from + cmd.apply.length }
          })
          
          // Special cursor placement for things like code blocks and tables
          if (cmd.label === '/code') {
            view.dispatch({ selection: { anchor: from + 4 } })
          } else if (cmd.label === '/bold' || cmd.label === '/italic') {
            const offset = cmd.label === '/bold' ? 2 : 1
            view.dispatch({ selection: { anchor: from + cmd.apply.length - offset } })
          }
        }
      })),
    filter: false
  }
}
