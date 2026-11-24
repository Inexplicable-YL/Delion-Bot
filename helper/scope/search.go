package scope

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"os"
	"path"
	"regexp"
)

type Match struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Text string `json:"text"`
}

func search(ctx context.Context, root *os.Root, input Request) Response {
	if input.Pattern == "" || len(input.Pattern) > 512 {
		return Response{Error: "搜索模式必须为 1 至 512 字节"}
	}
	var expression *regexp.Regexp
	var err error
	if input.Action == "grep" {
		expression, err = regexp.Compile(input.Pattern)
	} else {
		_, err = path.Match(input.Pattern, "")
	}
	if err != nil {
		return Response{Error: "无效的搜索模式"}
	}
	var reply Response
	visited, remaining := 0, 8*1024*1024
	err = fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, err error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if visited >= 10_000 || remaining <= 0 || len(reply.Entries)+len(reply.Matches) >= 200 {
			reply.Limited = true
			return fs.SkipAll
		}
		visited++
		if err != nil {
			if entry != nil && entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if name == "." {
			return nil
		}
		if internalName(entry.Name()) {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if !entry.IsDir() && !entry.Type().IsRegular() {
			return nil
		}
		visible := path.Join(input.Path, name)
		if expression == nil {
			if match, _ := path.Match(input.Pattern, entry.Name()); match {
				reply.Entries = append(reply.Entries, visible)
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil || info.Size() > 200_000 || info.Size() > int64(remaining) {
			return nil
		}
		remaining -= int(info.Size())
		data, err := readFile(root, name, max(1, info.Size()))
		if err != nil || bytes.ContainsRune(data, '\x00') {
			return nil
		}
		lineNumber := 0
		for line := range bytes.SplitSeq(data, []byte{'\n'}) {
			lineNumber++
			if !expression.Match(line) {
				continue
			}
			reply.Matches = append(reply.Matches, Match{
				Path: visible,
				Line: lineNumber,
				Text: string(line[:min(len(line), 512)]),
			})
			if len(reply.Matches) == 200 {
				reply.Limited = true
				return fs.SkipAll
			}
		}
		return nil
	})
	if err != nil && !errors.Is(err, fs.SkipAll) {
		return Response{Error: "搜索未完成"}
	}
	return reply
}
