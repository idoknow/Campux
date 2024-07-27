package util

import "math/rand"

func StringInSlice(str string, list []string) bool {
	for _, v := range list {
		if v == str {
			return true
		}
	}
	return false
}

func RandomString(length int) string {
	list := []byte("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")

	var result []byte

	for i := 0; i < length; i++ {
		result = append(result, list[rand.Intn(len(list))])
	}

	return string(result)
}
