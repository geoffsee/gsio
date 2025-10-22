import React, {useState} from 'react';
import {Box, Newline, render, Text, useInput} from 'ink';
// import OpenAI from 'openai';
import { Agent, run, type StreamedRunResult } from '@openai/agents';

const agent = new Agent({
	name: 'Assistant',
	instructions: 'You are a helpful assistant',
});

type Message = {
	role: 'user' | 'assistant';
	content: string;
};

export const Chat = () => {
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState('');
	const [response, setResponse] = useState<string | null>(null);
	const [isStreaming, setIsStreaming] = useState(false);

	// Handle keyboard input
	useInput((inputKey, key) => {
		if (key.return) {
			if (input.trim().length === 0 || isStreaming) return;
			const newMessages = [...messages, {role: 'user', content: input}];
			// @ts-ignore
			setMessages(newMessages);
			setInput('');
			// @ts-ignore
			streamResponse(newMessages);
		} else if (key.backspace) {
			setInput(prev => prev.slice(0, -1));
		} else if (!key.ctrl && !key.meta && !key.shift) {
			setInput(prev => prev + inputKey);
		}
	});

	// Stream response from OpenAI
	const streamResponse = async (chatHistory: Message[]) => {
		setIsStreaming(true);
		setResponse('');

		// Get the last user message
		const lastMessage = chatHistory[chatHistory.length - 1]?.content || '';

		const stream: StreamedRunResult<any, any> = await run(
			agent,
			lastMessage,
			{stream: true}
		);

		// Iterate through streaming events to collect text in realtime
		let fullResponse = '';
		for await (const event of stream) {
			if (event.type === 'raw_model_stream_event' &&
			    event.data.type === 'output_text_delta') {
				// Accumulate text deltas from the model
				const delta = event.data.delta;
				if (delta) {
					fullResponse += delta;
					setResponse(fullResponse);
				}
			}
		}

		// Add the complete response to message history
		// @ts-ignore
		setMessages([...chatHistory, {role: 'assistant', content: fullResponse}]);
		setIsStreaming(false);
	};

	return (
		<Box flexDirection="column">
			<Text color="cyan">🧠 GPT Chat (press Enter to send)</Text>
			<Newline />
			{messages.map((msg, i) => (
				<Box key={i} flexDirection="column" marginBottom={1}>
					<Text color={msg.role === 'user' ? 'green' : 'yellow'}>
						{msg.role === 'user' ? 'You: ' : 'AI: '}
						{msg.content}
					</Text>
				</Box>
			))}

			{isStreaming && (
				<Text color="yellow">{response}</Text>
			)}

			<Newline />
			<Text>
				<Text color="magenta">{'>'}</Text> {input}
			</Text>
		</Box>
	);
};

render(<Chat />);

