import { StreamingTextResponse, LangChainStream } from "ai";
import { auth, currentUser } from "@clerk/nextjs";
import { CallbackManager } from "langchain/callbacks"
import { NextResponse } from "next/server";
import { Replicate } from "langchain/llms/replicate"
import { MemoryManager } from "@/lib/memory";
import prismadb from "@/lib/prismadb";
import { rateLimit } from "@/lib/rate-limit";


export async function POST(
    request: Request,
    { params }: { params : { chatId: string } }
) {
    try {
        const { prompt } = await request.json();
        const user = await currentUser();

        if (!user || !user.firstName || !user.id) {
            return new NextResponse("Unauthorised", { status: 401 })
        }

        const identifier = request.url + "_" + user.id
        const { success } = await rateLimit(identifier)

        if (!success) {
            return new NextResponse( "Rate Limit exceeded", {status: 429} );
        }

        const companion = await prismadb.companion.update({
            where: {
                id: params.chatId,
                //userId:user.id,
            },
            data: {
                messages: {
                    create: {
                        content: prompt,
                        role: "user",
                        userId: user.id
                    }
                }
            }
        });

        if (!companion) {
            return new NextResponse ( "Companion not found", {status: 404} );
        }

        const name = companion.id;
        const companion_file_name = name + ".txt";

        const companionKey ={
            companionName: name,
            userId: user.id,
            modelName: "llama-2-13b"
        };

        const memoryManager = await MemoryManager.getInstance();

        const records = await memoryManager.readLatestHistory(companionKey);

        if(records.length === 0) {
            await memoryManager.seedChatHistory(companion.seed, "\n\n", companionKey);
        }
        await memoryManager.writeToHistory("User: "+prompt+"\n", companionKey);

        const recentChatHistory =await memoryManager.readLatestHistory(companionKey);

        const similarDocs = await memoryManager.vectorSearch(
            recentChatHistory,
            companion_file_name,
        );

        let relevantHistory ="";

        if(!!similarDocs && similarDocs.length !== 0){
            relevantHistory = similarDocs.map((doc) => doc.pageContent).join("\n");
        }

        const{handlers} =LangChainStream();
       // const input={};
        const model = new Replicate({
            model: "lucataco/llama-2-13b-chat:18f253bfce9f33fe67ba4f659232c509fbdfb5025e5dbe6027f72eeb91c8624b",
            input: {
                max_length: 2048,
            },
            apiKey: process.env.REPLICATE_API_TOKEN,
            callbackManager: CallbackManager.fromHandlers(handlers),
            
        });
       // const output = await model.run("lucataco/llama-2-13b-chat:18f253bfce9f33fe67ba4f659232c509fbdfb5025e5dbe6027f72eeb91c8624b", { input });
       // console.log(output)
        model.verbose=true;
        const response= String(
            await model.call(
                `
                Only generate plain sentences without prefix of who is speaking. DO NOT use ${name}: prefix.

                ${companion.instructions}

                Below are the relevant details about ${name}'s past and the conversation you are in.
                ${relevantHistory}

                ${recentChatHistory}\n${name}:
                `
            )
            .catch(console.error)
        );

        /*const cleaned = resp.replaceAll(",", "");
        const chunks=cleaned.split("\n");
        const response = chunks[0];*/

        await memoryManager.writeToHistory(""+ response.trim(), companionKey);
        var Readable=require("stream").Readable;

        let s = new Readable();
        s.push(response);
        s.push(null);


        if (response!== undefined && response.length > 1){
            memoryManager.writeToHistory(""+response.trim(), companionKey);
            await prismadb.companion.update({
                where: {
                    id:params.chatId,
                },
                data: {
                    messages: {
                    create: {
                        content: response.trim(),
                        role: "system",
                        userId: user.id
                    }
                    }
                }
            })
        };
        return new StreamingTextResponse(s);

    } catch (error) {
        console.log("[CHAT_POST]", error);
        return new NextResponse( "Internal Error", {status: 500} )
    }
}
