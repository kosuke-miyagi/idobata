import { Result, err, ok } from "neverthrow";
import OpenAI from "openai";
import { OPENROUTER_API_KEY } from "../config.js";
import { McpClientError } from "../types/errors.js";
import { logger } from "../utils/logger.js";
import { McpClient } from "./client.js";

export class IdobataMcpServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdobataMcpServiceError";
  }
}

interface McpTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

function convertMcpToolsToOpenAI(
  mcpTools: McpTool[]
): OpenAI.Chat.ChatCompletionTool[] {
  return mcpTools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: {
        type: "object",
        properties: tool.input_schema.properties || {},
        required: tool.input_schema.required || [],
      },
    },
  }));
}

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: OPENROUTER_API_KEY,
});

// [公開デプロイ用 2026-06-16] 使用するLLMモデルを環境変数で切替可能に（未設定なら従来のGemini）。
// OpenRouterのモデルID（例: anthropic/claude-sonnet-4 , openai/gpt-4o , google/gemini-2.5-flash）を
// 環境変数 OPENROUTER_MODEL に設定すると切り替わる。
const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL || "google/gemini-2.5-pro-preview-03-25";

export class IdobataMcpService {
  constructor(private mcpClient: McpClient) {}

  async processQuery(
    query: string,
    history: OpenAI.Chat.ChatCompletionMessageParam[] = [],
    branchId?: string,
    fileContent?: string,
    userName?: string,
    filePath?: string
  ): Promise<Result<string, IdobataMcpServiceError | McpClientError>> {
    if (!this.mcpClient.initialized) {
      return err(new IdobataMcpServiceError("MCP client is not connected"));
    }

    const tools = this.mcpClient.tools;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `あなたは、ユーザーが政策案の改善提案を作成するのを支援するAIアシスタントです。「現在のファイル内容」として提供された政策文書について、ユーザー（名前：${userName || "不明"}）が改善提案を練り上げるのを手伝うことがあなたの目標です。

# 背景知識（この選挙・組織の前提。提案は必ずこれを踏まえること）
## N高グループ
N高・S高・R高からなるオンライン主体の通信制高校（角川ドワンゴ学園）。全校生徒 約35,700名。生徒は全国・海外に分散し、連絡は主にSlackで行われる。
## 生徒会（役員会）
ミッションは「生徒が主体の未来の学校づくりを推進する」。役員24名＋委員会メンバーで構成員約500名、年間130〜300件の企画を実施。予算は基本1,000万円・2024年実績2,100万円（協賛・ファンドレイズ含む）＝相応の予算と実行力がある。委員会はデジタル/メディア広報/イベント企画/渉外/地域国際の5つ。公約は「この権限・予算・委員会体制で実現可能か」を意識すること。オンライン主体のため、校庭・教室など物理前提の施策より、全国の生徒に届くオンライン施策・Slack活用・地区/委員会横断の取り組みの方が有効。
## 選挙（2026年・第5期）
役員定数24（地区代表19＋委員会代表5）。会長・副会長等は当選後の役員合議で決定。候補者「法月こうすけ」は中部地区の地区代表に立候補（中部定数3／中部＝新潟・富山・石川・福井・山梨・長野・岐阜・静岡・愛知）。投票するのは中部在住の生徒（一人最大3票）。任期2026年8月〜2027年7月。スローガンは「生徒会を楽しもう！」。
## 提案づくりの方針
生徒目線で、上記の権限・予算・オンライン環境を踏まえ、実現可能性のある具体的な公約に磨くこと。「金品と引き換えの投票呼びかけ」「寄付・贈与」は禁止なので、公約内容がこれに抵触しないよう留意する。

政策案は共有オンラインワークスペース（GitHub）で保管・管理されています。あなたのタスクは、改善の可能性についてユーザーと議論し、ファイル内容を変更し、他の人によるレビューのために準備することです。

以下の手順で協力しましょう：
1.  **改善点の議論:** ユーザーが政策改善のアイデアを共有します。これらのアイデアについて、批判的に議論してください。ユーザーの提案に疑問を投げかけ、最終的な変更が強力でよく考慮されたものになるように、その影響をユーザーが考えるのを手伝ってください。提供されたテキストのみを扱ってください。
2.  **下書きの編集:** 具体的な変更点について合意したら、利用可能なツールを使って、これらの変更をあなた専用の下書きスペース（ブランチ）にて、「${filePath}」にあるファイルの新しいバージョン（コミット）として保存します。これはユーザーの個人的な編集作業です。変更点の要約を提示して最終確認を求め、承認を得たら直接変更をコミットします。変更箇所は本当に必要なものだけにしてください。コミットメッセージにはユーザー名（${userName || "不明"}）を含めてください。
    この作業は、ユーザーが望む限り何度でも繰り返せます。
3.  **改善提案の投稿の準備:** 下書きの編集にユーザーが満足したら、改善提案を投稿する準備をします。利用可能なツールを使ってプルリクエストのタイトルと説明を設定してください。ツールで設定するプルリクエストの説明には、行われた改善点、その意図や目的、背景などを可能な限り明確かつ詳細（1000文字以上）に述べ、ユーザー名（${userName || "匿名"}）を記載しましょう。このメッセージは、変更内容とその理由を他の人に伝えるために使われます（プルリクエスト）。
4.  **リンクの共有:** ツールを使ってプルリクエストを更新した後に、提案された変更へのウェブリンク（プルリクエストリンク）をユーザーに提供してください。

注意点：ユーザーは「Git」、「コミット」、「ブランチ」、「プルリクエスト」のような技術用語に詳しくありません。プロセスやあなたが取る行動を説明する際には、シンプルで日常的な言葉を使用してください。提供された政策文書の内容改善にのみ集中しましょう。
【最重要・必須】ツール（変更の保存・プルリクエストの準備/更新など）を実行した直後は、必ず日本語のテキストで結果を一言報告してください（例：「下書きに〇〇を反映しました。次は△△もできますよ」）。ツールを呼び出すだけで終わって、空の応答や無言で会話を終えることは絶対にしないでください。どのターンでも必ず、ユーザー向けの文章メッセージを返すこと。
返答は最大500文字。`,
      },
      ...history,
    ];

    let contextContent = "";
    if (branchId) {
      contextContent += `Current Branch ID: ${branchId}\n`;
    }
    if (filePath) {
      contextContent += `Current File Path: ${filePath}\n`;
    }
    if (fileContent) {
      const maxContentLength = 50000;
      const truncatedContent =
        fileContent.length > maxContentLength
          ? `${fileContent.substring(0, maxContentLength)}\n... (content truncated)`
          : fileContent;
      contextContent += `\nCurrent File Content:\n\`\`\`\n${truncatedContent}\n\`\`\``;
    }

    if (contextContent) {
      messages.push({
        role: "system",
        content: contextContent.trim(),
      });
    }

    messages.push({
      role: "user",
      content: query,
    });

    try {
      const openaiTools = convertMcpToolsToOpenAI(tools);

      const response = await openai.chat.completions.create({
        model: OPENROUTER_MODEL,
        messages: messages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        tool_choice: openaiTools.length > 0 ? "auto" : undefined,
        max_tokens: 50000,
      });

      const finalText: string[] = [];

      if (response.choices && response.choices.length > 0) {
        const message = response.choices[0].message;

        if (message.content) {
          finalText.push(message.content);
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
          messages.push({
            role: "assistant",
            content: message.content,
            tool_calls: message.tool_calls,
          });

          for (const toolCall of message.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs = {};

            try {
              toolArgs = JSON.parse(toolCall.function.arguments);
            } catch (parseError) {
              logger.error(
                `Failed to parse arguments for tool ${toolName}:`,
                parseError
              );
              messages.push({
                tool_call_id: toolCall.id,
                role: "tool",
                content: `Error: Invalid arguments format. ${parseError instanceof Error ? parseError.message : "Unknown parsing error"}`,
              });
              continue;
            }

            logger.debug(`Calling tool ${toolName} with args:`, toolArgs);

            const toolResult = await this.mcpClient.callTool(
              toolName,
              toolArgs
            );
            if (toolResult.isErr()) {
              logger.error(`Error calling tool ${toolName}:`, toolResult.error);
              messages.push({
                tool_call_id: toolCall.id,
                role: "tool",
                content: `Error executing tool: ${toolResult.error.message}`,
              });
            } else {
              const result = toolResult.value as { content?: unknown };
              messages.push({
                tool_call_id: toolCall.id,
                role: "tool",
                content: JSON.stringify(result.content || result),
              });
            }
          }

          const followUpResponse = await openai.chat.completions.create({
            model: OPENROUTER_MODEL,
            messages: messages,
            max_tokens: 50000,
          });

          if (followUpResponse.choices && followUpResponse.choices.length > 0) {
            finalText.push(followUpResponse.choices[0].message.content || "");
          }
        }
      }

      if (finalText.length === 0 || finalText.every((t) => t.trim() === "")) {
        return ok(
          "I received the request but didn't generate a text response."
        );
      }

      return ok(finalText.join("\n").trim());
    } catch (error) {
      logger.error("Error processing query:", error);
      return err(
        new IdobataMcpServiceError(
          `Failed to process query: ${error instanceof Error ? error.message : "Unknown error"}`
        )
      );
    }
  }
}
