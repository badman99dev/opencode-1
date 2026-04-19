import z from "zod"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import * as Tool from "./tool"
import DESCRIPTION from "./google.txt"

const Parameters = z.object({
  query: z.string().describe("Google search query"),
  numResults: z.number().optional().describe("Number of search results to return (default: 10)"),
  gl: z.string().optional().describe("Country code for region-specific results (e.g., 'us', 'in')"),
  hl: z.string().optional().describe("Language code for results (e.g., 'en', 'hi')"),
})

export const GoogleTool = Tool.define(
  "google",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(http)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "google",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              numResults: params.numResults,
            },
          })

          const apiKey = "e1ee752adc11668802ff161c4c6f38f52ca52498"

          const requestBody = {
            q: params.query,
            num: params.numResults ?? 10,
            ...(params.gl && { gl: params.gl }),
            ...(params.hl && { hl: params.hl }),
          }

          const request = yield* HttpClientRequest.post("https://google.serper.dev/search").pipe(
            HttpClientRequest.setHeaders({
              "X-API-KEY": apiKey,
              "Content-Type": "application/json",
            }),
            HttpClientRequest.schemaBodyJson(z.any()(requestBody)),
          )

          const response = yield* httpOk.execute(request)
          const json = yield* response.json

          const organicResults = (json.organic ?? []) as Array<{
            title: string
            link: string
            snippet: string
            position?: number
          }>

          const knowledgeGraph = json.knowledgeGraph as
            | { title?: string; type?: string; description?: string; attributes?: Record<string, string> }
            | undefined

          const peopleAlsoAsk = (json.peopleAlsoAsk ?? []) as Array<{
            question: string
            snippet: string
            link: string
          }>

          let output = ""

          if (knowledgeGraph && knowledgeGraph.title) {
            output += `## Knowledge Graph: ${knowledgeGraph.title}\n`
            if (knowledgeGraph.type) output += `**Type:** ${knowledgeGraph.type}\n`
            if (knowledgeGraph.description) output += `${knowledgeGraph.description}\n\n`
            if (knowledgeGraph.attributes) {
              for (const [key, value] of Object.entries(knowledgeGraph.attributes)) {
                output += `- **${key}:** ${value}\n`
              }
              output += "\n"
            }
          }

          if (organicResults.length > 0) {
            output += "## Organic Search Results\n\n"
            output += organicResults
              .map(
                (r, i) =>
                  `${i + 1}. **${r.title}**\n   URL: ${r.link}\n   ${r.snippet}`,
              )
              .join("\n\n")
          }

          if (peopleAlsoAsk.length > 0) {
            output += "\n\n## People Also Ask\n\n"
            output += peopleAlsoAsk
              .map((q) => `- **${q.question}**: ${q.snippet}`)
              .join("\n")
          }

          if (!output) {
            output = "No search results found. Please try a different query."
          }

          return {
            title: `Google search: ${params.query}`,
            output,
            metadata: {
              totalResults: organicResults.length,
              hasKnowledgeGraph: !!knowledgeGraph?.title,
              hasPeopleAlsoAsk: peopleAlsoAsk.length > 0,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
