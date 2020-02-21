// ref: https://github.com/sourcegraph/sourcegraph-terraform/blob/master/src/lang-terraform.ts
import '@babel/polyfill'

import { Handler, initLSIF, impreciseBadge } from '@sourcegraph/basic-code-intel'
import * as sourcegraph from 'sourcegraph'


interface Providers {
    hover: (doc: sourcegraph.TextDocument, pos: sourcegraph.Position) => Promise<sourcegraph.Hover | null>
    definition: (doc: sourcegraph.TextDocument, pos: sourcegraph.Position) => Promise<sourcegraph.Definition | null>
    references: (doc: sourcegraph.TextDocument, pos: sourcegraph.Position) => Promise<sourcegraph.Location[] | null>
}

function initBasicCodeIntel(): Providers {
    const handler = new Handler({
        sourcegraph,
        languageID: 'terraform',
        fileExts: ['tf'],
        commentStyle: {
            lineRegex: /\/\/\s?/,
        },
    })
    return {
        hover: handler.hover.bind(handler),
        definition: handler.definition.bind(handler),
        references: handler.references.bind(handler),
    }
}

// No-op for Sourcegraph versions prior to 3.0.
const DUMMY_CTX = { subscriptions: { add: (_unsubscribable: any) => void 0 } }

const terraformFiles = [{ pattern: '*.tf' }]

export function activate(ctx: sourcegraph.ExtensionContext = DUMMY_CTX): void {
    async function afterActivate(): Promise<void> {
        const lsif = initLSIF()
        const basicCodeIntel = initBasicCodeIntel()

        ctx.subscriptions.add(
            sourcegraph.languages.registerHoverProvider(terraformFiles, {
                provideHover: async (doc, pos) => {
                    const lsifResult = await lsif.hover(doc, pos)
                    if (lsifResult) {
                        return lsifResult.value
                    }

                    const val = await basicCodeIntel.hover(doc, pos)
                    if (!val) {
                        return undefined
                    }

                    return { ...val, badge: impreciseBadge }
                },
            })
        )
        ctx.subscriptions.add(
            sourcegraph.languages.registerDefinitionProvider(terraformFiles, {
                provideDefinition: async (doc, pos) => {
                    const lsifResult = await lsif.definition(doc, pos)
                    if (lsifResult) {
                        return lsifResult.value
                    }

                    const val = await basicCodeIntel.definition(doc, pos)
                    if (!val) {
                        return undefined
                    }

                    if (Array.isArray(val)) {
                        return val.map(v => ({ ...v, badge: impreciseBadge }))
                    }

                    return { ...val, badge: impreciseBadge }
                },
            })
        )
        ctx.subscriptions.add(
            sourcegraph.languages.registerReferenceProvider(terraformFiles, {
                provideReferences: async (doc, pos) => {
                    // Concatenates LSIF results (if present) with fuzzy results
                    // because LSIF data might be sparse.
                    const lsifReferences = await lsif.references(doc, pos)
                    const fuzzyReferences = (await basicCodeIntel.references(doc, pos)) || []

                    const lsifFiles = new Set((lsifReferences ? lsifReferences.value : []).map(file))

                    return [
                        ...(lsifReferences === undefined ? [] : lsifReferences.value),
                        // Drop fuzzy references from files that have LSIF results.
                        ...fuzzyReferences
                            .filter(fuzzyRef => !lsifFiles.has(file(fuzzyRef)))
                            .map(v => ({
                                ...v,
                                badge: impreciseBadge,
                            })),
                    ]
                },
            })
        )
    }
    setTimeout(afterActivate, 100)
}
