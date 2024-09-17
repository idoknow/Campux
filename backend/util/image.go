package util

import (
	"bytes"
	"image"
	_ "image/gif" // register gif format
	"image/jpeg"
	_ "image/png" // register png format
	"io"
)

func CompressImage(input []byte, quality int) (io.Reader, error) {
	img, _, err := image.Decode(bytes.NewReader(input))
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer

	err = jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality})
	if err != nil {
		return nil, err
	}

	return bytes.NewReader(buf.Bytes()), nil
}
