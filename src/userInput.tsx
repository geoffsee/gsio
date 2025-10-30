import React from 'react';
import {Box, Newline, Text} from 'ink';

type UserInputProps = {
  value: string;
  cursor: number;
  debug?: boolean;
  lastInput: string;
  lastFlags: string;
  lastAction: string;
};

export const UserInput = ({
  value,
  cursor,
  debug = false,
  lastInput,
  lastFlags,
  lastAction,
}: UserInputProps) => {
  const left = value.slice(0, cursor);
  const right = value.slice(cursor);

  return (
    <Box flexDirection="column" flexShrink={0} marginTop={1}>
      <Text>
        <Text color="magenta">{'>'}</Text>{' '}
        {left}
        <Text color="magenta">|</Text>
        {right}
      </Text>

      {debug && (
        <>
          <Newline />
          <Text color="gray">[debug] input: {lastInput}</Text>
          <Text color="gray">[debug] flags: {lastFlags}</Text>
          <Text color="gray">[debug] action: {lastAction}</Text>
          <Text color="gray">[debug] cursor: {cursor}/{value.length}</Text>
        </>
      )}
    </Box>
  );
};
