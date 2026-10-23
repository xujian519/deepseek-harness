/** LegalKnowledge service wiring over SQLite and in-memory backends. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LegalKnowledge } from '../src/index.ts'
import type { CaseLawRecord, GuidingCaseRecord, JudicialInterpretationRecord, LegalRegulationRecord } from '../src/types.ts'

const tempDirs: string[] = []
const contexts: Context[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'legal-knowledge-service-'))
  tempDirs.push(dir)
  return dir
}

function createKnowledgeDb(dir: string): void {
  const db = new DatabaseSync(join(dir, 'legal.db'))
  try {
    db.exec(`
      CREATE TABLE case_law (
        id INTEGER PRIMARY KEY, case_id TEXT, doc_type TEXT, case_name TEXT, court TEXT,
        decision_date TEXT, case_number TEXT, case_type TEXT, full_text TEXT, summary TEXT
      );
      INSERT INTO case_law VALUES (1, 'case-1', 'judgment', '合同纠纷案', '北京法院', '2023-01-01', 'N-1', 'civil', '合同违约', '违约');
      CREATE TABLE legal_regulations (
        id INTEGER PRIMARY KEY, regulation_id TEXT, regulation_name TEXT, level TEXT,
        publish_date TEXT, effective_date TEXT, expiry_date TEXT, expired INTEGER,
        article_number INTEGER, article_text TEXT, source_path TEXT
      );
      INSERT INTO legal_regulations VALUES (1, 'reg-1', '民法典', '法律', '2020-01-01', '2021-01-01', NULL, 0, 577, '违约责任', NULL);
      CREATE TABLE judicial_interpretations (
        id INTEGER PRIMARY KEY, interpretation_id TEXT, interpretation_name TEXT, interpretation_type TEXT,
        issuing_body TEXT, document_number TEXT, publish_date TEXT, effective_date TEXT, expiry_date TEXT,
        expired INTEGER, article_number INTEGER, article_text TEXT, source_path TEXT
      );
      INSERT INTO judicial_interpretations VALUES (1, 'interp-1', '合同解释', 'judicial-interpretation', 'SPC', '法释1', '2023-01-01', '2023-02-01', NULL, 0, 1, '合同纠纷处理', NULL);
      CREATE TABLE guiding_cases (
        id INTEGER PRIMARY KEY, case_id TEXT, guiding_case_number TEXT, case_name TEXT, court TEXT,
        decision_date TEXT, case_type TEXT, key_points TEXT, related_laws TEXT, full_text TEXT
      );
      INSERT INTO guiding_cases VALUES (1, 'gc-1', '指导案例1号', '居间合同案', '法院', '2011-01-01', 'civil', '居间合同', '[]', '全文');
    `)
  } finally {
    db.close()
  }
}

function createService(config: ConstructorParameters<typeof LegalKnowledge>[1]): LegalKnowledge {
  const ctx = new Context()
  contexts.push(ctx)
  return new LegalKnowledge(ctx, config)
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const CASE_LAW: CaseLawRecord = {
  caseId: 'memory-case', docType: 'judgment', caseName: 'Memory case', court: 'Court',
  decisionDate: '2024-01-01', caseNumber: 'N', caseType: 'civil', fullText: 'memory full text',
}
const REGULATION: LegalRegulationRecord = {
  regulationId: 'memory-reg', regulationName: 'Memory regulation', level: '法律',
  effectiveDate: '2021-01-01', validity: 'unverified', articleNumber: 1, articleText: 'memory article',
}
const INTERPRETATION: JudicialInterpretationRecord = {
  interpretationId: 'memory-interp', interpretationName: 'Memory interpretation',
  interpretationType: 'judicial-interpretation', issuingBody: 'SPC', documentNumber: '法释',
  effectiveDate: '2021-01-01', validity: 'unverified', articleNumber: 1, articleText: 'memory text',
}
const GUIDING_CASE: GuidingCaseRecord = {
  caseId: 'memory-guiding', guidingCaseNumber: 'Case', caseName: 'Memory guiding case',
  court: 'Court', decisionDate: '2021-01-01', caseType: 'civil', keyPoints: 'memory key',
  relatedLaws: [], fullText: 'memory full',
}

describe('LegalKnowledge service', () => {
  it('uses the default config and in-memory engines', () => {
    const service = createService({})
    expect(service.paths.dataDir).toBeDefined()
    expect(service.caseLawSearch('missing')).toEqual([])
  })

  it('searches every backend through one SQLite connection', () => {
    const dir = tempDir()
    createKnowledgeDb(dir)
    const service = createService({ knowledgeDir: dir, useFts5: true })
    expect(service.caseLawSearch('合同')[0]?.caseId).toBe('case-1')
    expect(service.legalSearch('违约')[0]?.regulationId).toBe('reg-1')
    expect(service.judicialInterpretationSearch('合同')[0]?.interpretationId).toBe('interp-1')
    expect(service.guidingCaseSearch('居间')[0]?.caseId).toBe('gc-1')
    service.addCaseLawRecords([])
    service.addLegalRegulationRecords([])
    service.addJudicialInterpretationRecords([])
    service.addGuidingCaseRecords([])
  })

  it('keeps engines in memory when FTS is disabled', () => {
    const dir = tempDir()
    createKnowledgeDb(dir)
    const service = createService({ knowledgeDir: dir, useFts5: false })
    service.addCaseLawRecords([CASE_LAW])
    service.addLegalRegulationRecords([REGULATION])
    service.addJudicialInterpretationRecords([INTERPRETATION])
    service.addGuidingCaseRecords([GUIDING_CASE])
    expect(service.caseLawSearch('memory')[0]?.via).toBe('memory')
    expect(service.legalSearch('memory')[0]?.via).toBe('memory')
    expect(service.judicialInterpretationSearch('memory')[0]?.via).toBe('memory')
    expect(service.guidingCaseSearch('memory')[0]?.via).toBe('memory')
  })

  it('uses memory when the knowledge directory holds no database', () => {
    const service = createService({ knowledgeDir: tempDir(), useFts5: true })
    expect(service.caseLawSearch('missing')).toEqual([])
  })
})
