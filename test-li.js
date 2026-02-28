import 'dotenv/config';
import { Document, SummaryIndex, Settings, BaseEmbedding } from 'llamaindex';
import { Gemini } from '@llamaindex/google';

class DummyEmbedding extends BaseEmbedding {
  async getTextEmbedding(text) { return [0.1]; }
}

async function test() {
  const gemini = new Gemini({ model: "gemini-1.5-flash", apiKey: process.env.GEMINI_API_KEY });
  Settings.llm = gemini;
  Settings.embedModel = new DummyEmbedding();

  const doc = new Document({ text: "Player sdf missed the beat. Player kk voted for Dubstep. The match lasted 45 seconds." });
  const index = await SummaryIndex.fromDocuments([doc]);

  const queryEngine = index.asQueryEngine();
  const response = await queryEngine.query({ query: "Act as a snarky esports commentator. What just happened?" });
  console.log("RESPONSE:", response.toString());
}
test().catch(console.error);
