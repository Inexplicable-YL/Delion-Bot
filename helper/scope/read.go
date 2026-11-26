package scope

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"unicode/utf8"
)

func readPage(ctx context.Context, root *os.Root, name string, input Request) Response {
	failure := Response{Error: "Unable to read the file."}
	file, err := openVerifiedFile(root, name)
	if err != nil {
		return failure
	}
	defer file.Close()
	if input.ByteOffset != nil {
		offset := *input.ByteOffset
		if offset < 0 {
			return Response{Error: "Invalid byte offset."}
		}
		if _, err := file.Seek(offset, io.SeekStart); err != nil {
			return failure
		}
		data, err := io.ReadAll(io.LimitReader(file, input.Limit+1))
		if err != nil {
			return failure
		}
		if offset > 0 && len(data) == 0 {
			return Response{Error: fmt.Sprintf("Byte offset %d is at or past the end of the file.", offset)}
		}
		if int64(len(data)) <= input.Limit {
			return Response{Data: data}
		}
		end := int(input.Limit)
		for end > 0 && !utf8.RuneStart(data[end]) {
			end--
		}
		if end == 0 {
			end = int(input.Limit)
		}
		return Response{Data: data[:end], NextByteOffset: offset + int64(end)}
	}
	if input.LineOffset < 1 || input.LineLimit < 1 {
		return Response{Error: "Invalid line range."}
	}
	reader := bufio.NewReaderSize(file, int(input.Limit)+1)
	line := int64(1)
	var offset int64
	var partialLine bool
	beyondEOF := func() Response {
		return Response{Error: fmt.Sprintf("Offset %d is past the end of the file (%d lines total).", input.LineOffset, line-1)}
	}
	for line < input.LineOffset {
		if ctx.Err() != nil {
			return Response{Error: "Operation cancelled."}
		}
		part, err := reader.ReadSlice('\n')
		offset += int64(len(part))
		if errors.Is(err, bufio.ErrBufferFull) {
			partialLine = true
			continue
		}
		if errors.Is(err, io.EOF) {
			if partialLine || len(part) > 0 {
				line++
			}
			return beyondEOF()
		}
		if err != nil {
			return failure
		}
		line++
		partialLine = false
	}
	var data []byte
	for count := int64(0); count < input.LineLimit; count++ {
		part, err := reader.ReadSlice('\n')
		if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, bufio.ErrBufferFull) {
			return failure
		}
		if int64(len(data)+len(part)) > input.Limit || errors.Is(err, bufio.ErrBufferFull) {
			if len(data) == 0 {
				return Response{Error: fmt.Sprintf("Line %d exceeds the read limit. Use byteOffset: %d to read byte pages.", input.LineOffset, offset)}
			}
			return Response{Data: data, NextOffset: input.LineOffset + count}
		}
		data = append(data, part...)
		if errors.Is(err, io.EOF) {
			if count == 0 && len(part) == 0 && input.LineOffset > 1 {
				return beyondEOF()
			}
			return Response{Data: data}
		}
	}
	if _, err := reader.Peek(1); err == nil {
		return Response{Data: data, NextOffset: input.LineOffset + input.LineLimit}
	} else if !errors.Is(err, io.EOF) {
		return failure
	}
	return Response{Data: data}
}
