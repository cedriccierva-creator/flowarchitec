import type { WorkflowDocument } from './workflowDocument'

function plainText(value: string): string {
  return value.replace(/\r\n?/g, '\n').split('\n').map((line) => {
    const escaped = line.replace(/[\\\x60*_{}\[\]<>#~&|!]/g, '\\$&')
      .replace(/^(\s*)([-+=:]|\d{1,9}[.)])/, (_, space: string, marker: string) =>
        space + marker.slice(0, -1) + '\\' + marker.slice(-1))
    return escaped.replace(/^[ \t]+/, (indent) =>
      indent.replace(/[ \t]/g, (character) => character === '\t' ? '&#9;' : '&#32;'))
  }).join('  \n').replace(/^ +$/gm, '')
}

function field(title: string, value?: string): string {
  return '**' + title + '**\n\n' + (value?.trim() ? plainText(value) : 'Not documented.') + '\n'
}

export function exportMarkdown(workflow: WorkflowDocument): string {
  const { metadata, nodes, edges } = workflow
  const { overview } = metadata
  const incoming = new Set(edges.map(({ target }) => target))
  const outgoing = new Map<string, number>()
  for (const { source } of edges) outgoing.set(source, (outgoing.get(source) ?? 0) + 1)
  const branches = [...outgoing.values()].filter((count) => count > 1).length
  const nodeNumbers = new Map(nodes.map((node, index) => [node.id, { ...node, number: index + 1 }]))
  const endpoint = (id: string) => {
    const node = nodeNumbers.get(id)!
    return 'Node ' + node.number + ' · ' + node.label
  }

  return [
    '# Architecture documentation\n',
    '## Project Overview\n',
    field('Project name', metadata.name),
    field('Project summary', overview?.summary),
    field('Architecture goals', overview?.goals),
    field('Assumptions', overview?.assumptions),
    field('Constraints', overview?.constraints),
    '## Workflow Summary\n',
    '- Nodes: ' + nodes.length + '\n- Connections: ' + edges.length + '\n',
    field('Architecture description', nodes.length
      ? 'Nodes without incoming connections: ' + (nodes.length - incoming.size) + '\n'
        + 'Nodes with multiple outgoing connections: ' + branches
      : 'The workflow is empty.'),
    '## Node Documentation\n',
    ...(!nodes.length ? ['No nodes.\n'] : nodes.flatMap((node, index) => [
      '### Node ' + (index + 1) + '\n',
      field('Technical label', node.label),
      ...(node.clientLabel ? [field('Client-facing label', node.clientLabel)] : []),
      ...(node.businessDescription ? [field('Business description', node.businessDescription)] : []),
      field('Purpose', node.documentation?.purpose),
      field('Inputs', node.documentation?.inputs),
      field('Outputs', node.documentation?.outputs),
      field('Configuration notes', node.documentation?.configuration),
      field('Error-handling strategy', node.documentation?.errorHandling),
    ])),
    '## Connection Documentation\n',
    ...(!edges.length ? ['No connections.\n'] : edges.flatMap((edge, index) => [
      '### Connection ' + (index + 1) + '\n',
      field('Source node', endpoint(edge.source)),
      field('Target node', endpoint(edge.target)),
      ...(edge.label ? [field('Visible edge label', edge.label)] : []),
      ...(edge.description ? [field('Technical description', edge.description)] : []),
    ])),
  ].join('\n')
}
