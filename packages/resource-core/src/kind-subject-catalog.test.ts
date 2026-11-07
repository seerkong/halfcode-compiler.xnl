import { expect, test } from 'bun:test'
import { loadResourceTreeFromReadPort, composeLayeredResourceRegistry, digestCanonical, type ResourcePackageReadPort } from './index'
import { KindContractRegistry, KindReaderRegistry, SpecResolutionRegistry, createKindSubjectOwner, createKindSpecRevision, createReaderProfile, resolveResourceTree, CORE_RESOURCE_CONTRACT_REGISTRATIONS } from 'halfcode-compiler-kind-definition'

async function load(options: Parameters<typeof loadResourceTreeFromReadPort>[0]) {
  try { return await loadResourceTreeFromReadPort(options) }
  catch (error) { throw new Error(JSON.stringify((error as { diagnostics?: unknown }).diagnostics ?? String(error))) }
}

const envelope = 'envelopeVersion="halfcode.resource-envelope/v1" specVersion=1'
const subjects = ['Example.Lite.Page', 'Example.DG.Page']
const definitions = subjects.map(subjectFqn => {
  const owner = createKindSubjectOwner({ kind: 'Page', subjectFqn, ownerPackageId: subjectFqn,
    ownerPackageFingerprint: digestCanonical(subjectFqn), sourceShapes: ['single-file'] })
  const revision = createKindSpecRevision({ kind: 'Page', subjectFqn, specVersion: 1,
    specSchema: { type: 'object' }, stability: 'stable', sourceContractFingerprint: owner.sourceContract.sourceContractFingerprint,
    semanticContract: { semanticValidatorFingerprint: digestCanonical('validate'), referenceProjectionFingerprint: digestCanonical('refs'), compilerInputFingerprint: digestCanonical(subjectFqn) } })
  return { owner, revision }
})

function port(files: Record<string, string>): ResourcePackageReadPort {
  return {
    stat: path => path === '/' ? { kind: 'directory' } : files[path] === undefined ? undefined : { kind: 'file' },
    readDirectory: () => Object.keys(files).map(path => ({ name: path.slice(1), kind: 'file' as const })),
    readBytes: path => files[path] === undefined ? undefined : new TextEncoder().encode(files[path]),
  }
}

async function definitionTree(index: number) {
  const { owner, revision } = definitions[index]!
  return load({ port: port({
    '/manifest.xnl': `<ResourcePackage #Example.Definitions${index} ${envelope} (<Catalogs [<FileResourceCatalog #defs { resourceKind="KindDefinition" root="vfs://./" entry="kind.xnl" }> ]>)>`,
    '/kind.xnl': `<KindDefinition #${owner.subjectFqn}.Definition ${envelope} {
      resourceKind="Page" subjectFqn="${owner.subjectFqn}" sourceShapes=["single-file"]
    } (<SpecRevisions [<SpecRevision { specVersion=1 schemaRef="vfs://./schema.json"
      schemaFingerprint="${revision.schemaFingerprint}" contractFingerprint="${revision.contractFingerprint}"
      semanticValidatorFingerprint="${revision.semanticContract.semanticValidatorFingerprint}"
      referenceProjectionFingerprint="${revision.semanticContract.referenceProjectionFingerprint}"
      compilerInputFingerprint="${revision.semanticContract.compilerInputFingerprint}" stability="stable" }> ]>)>`,
    '/schema.json': JSON.stringify(revision.specSchema),
  }) })
}

async function application(references: readonly string[], ids = ['Example.One', 'Example.Two']) {
  return load({ kindDefinitionImports: await Promise.all([definitionTree(0), definitionTree(1)]), port: port({
    '/manifest.xnl': `<ResourcePackage #Example.App ${envelope} (<Catalogs [${references.map((kind, index) => `<FileResourceCatalog #p${index} { resourceKind="${kind}" root="vfs://./" entry="page${index}.xnl" }>`).join('')} ]>)>`,
    ...Object.fromEntries(references.map((_, index) => [`/page${index}.xnl`, `<Page #${ids[index]} ${envelope} { title="Page ${index}" }>`])),
  }) })
}

test('catalogs bind identical Page tags to explicit subjects through imports, readers and layers', async () => {
  const tree = await application(subjects)
  expect(tree.registry.kindDefinitions.size).toBe(2)
  expect(() => tree.registry.kindDefinitions.get('Page')).toThrow('KIND_SUBJECT_AMBIGUOUS')
  expect(() => tree.registry.byKind.get('Page')).toThrow('KIND_SUBJECT_AMBIGUOUS')
  for (const subject of subjects) expect(tree.registry.byKind.get(subject)?.[0]?.subjectFqn).toBe(subject)

  const contracts = new KindContractRegistry()
  const readers = new KindReaderRegistry()
  const registrations = [...CORE_RESOURCE_CONTRACT_REGISTRATIONS.readers!, ...definitions.map(({ owner, revision }) => ({
    subjectFqn: owner.subjectFqn, readerId: `${owner.subjectFqn}.reader`, readerSpecVersion: 1,
    contractFingerprint: revision.contractFingerprint, readerImplementationFingerprint: digestCanonical(owner.subjectFqn),
    compatibilityPolicy: 'exact' as const, read: (spec: unknown) => ({ subject: owner.subjectFqn, spec }),
  }))]
  for (const owner of [...CORE_RESOURCE_CONTRACT_REGISTRATIONS.owners, ...definitions.map(value => value.owner)]) contracts.registerOwner(owner)
  for (const revision of [...CORE_RESOURCE_CONTRACT_REGISTRATIONS.revisions, ...definitions.map(value => value.revision)]) contracts.registerRevision(revision)
  for (const registration of registrations) readers.register(registration)
  const resolved = resolveResourceTree({ tree, contracts, readers, resolutions: new SpecResolutionRegistry(contracts),
    readerProfile: createReaderProfile('test', registrations), validator: { validate: () => [] } })
  for (const subject of subjects) expect(resolved.registry.byKind.get(subject)?.[0]?.readerValue).toMatchObject({ subject })

  const effective = composeLayeredResourceRegistry({ layers: [{ id: 'app', tree }] })
  expect(effective.kindDefinitions.get(subjects[0]!)?.definition.subjectFqn).toBe(subjects[0]!)
  expect(() => effective.byKind.get('Page')).toThrow('KIND_SUBJECT_AMBIGUOUS')
  for (const subject of subjects) expect(effective.byKind.get(subject)?.[0]?.subjectFqn).toBe(subject)
})

test('unqualified catalog references fail instead of choosing an import order', async () => {
  await expect(application(['Page'])).rejects.toThrow('KIND_SUBJECT_AMBIGUOUS')
})

test('a shared resource FQN cannot change its subject between layers', async () => {
  const first = await application([subjects[0]!], ['Example.Shared'])
  const second = await application([subjects[1]!], ['Example.Shared'])
  const composition = (tree: typeof first) => composeLayeredResourceRegistry({ layers: [{ id: 'one', tree }] })
  expect(composition(first).compositionRevision).not.toBe(composition(second).compositionRevision)
  expect(() => composeLayeredResourceRegistry({ layers: [{ id: 'first', tree: first }, { id: 'second', tree: second }] })).toThrow('Resource composition failed')
})
