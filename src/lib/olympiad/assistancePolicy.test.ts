import { describe, expect, it } from 'vitest'
import { evaluateAssistance } from './assistancePolicy'
describe('competition assistance restrictions', () => {
  it('allows independently authored training tasks', () => expect(evaluateAssistance({kind:'practice', independentlyAuthored:true}).allowed).toBe(true))
  it('blocks active competition tasks when organizers prohibit AI', () => expect(evaluateAssistance({kind:'competition',phase:'active',aiRule:'prohibited'})).toEqual({allowed:false,reason:'ai-prohibited'}))
  it('does not infer rights or completion from missing rules or dates', () => {
    expect(evaluateAssistance({kind:'unknown'}).allowed).toBe(false)
    expect(evaluateAssistance({kind:'archive',competitionClosed:true,trainingUseVerified:true}).allowed).toBe(true)
    expect(evaluateAssistance({kind:'archive',competitionClosed:false,trainingUseVerified:true}).allowed).toBe(false)
    expect(evaluateAssistance({kind:'practice',independentlyAuthored:false}).allowed).toBe(false)
    expect(evaluateAssistance({kind:'competition',phase:'unknown',aiRule:'allowed'}).allowed).toBe(false)
    expect(evaluateAssistance({kind:'competition',phase:'finished',aiRule:'prohibited'}).allowed).toBe(false)
  })
  it('recognizes an explicitly authorized active competition context', () => expect(evaluateAssistance({kind:'competition',phase:'active',aiRule:'allowed'}).allowed).toBe(true))
})
