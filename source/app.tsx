import React from 'react';
import {Text} from 'ink';
import {Chat} from './chat.js';

type Props = {
	name: string | undefined;
};

export default function App({name = 'Anon'}: Props) {
	return (
		<>
		<Chat/>
		<Text>
			Hello, <Text color="green">{name}</Text>
		</Text>
			</>
	);
}
