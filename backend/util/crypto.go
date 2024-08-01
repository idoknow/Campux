package util

import (
	"crypto/md5"
	"encoding/hex"
	"math/rand"
)

// MD5 encrypts a string with md5 algorithm
func MD5(s string) string {
	h := md5.New()
	h.Write([]byte(s))
	return hex.EncodeToString(h.Sum(nil))
}

// 随机生成一个包含小写字母和数字的字符串，长度为8
// 用于生成用户初始密码
func GenerateRandomPassword() string {
	const letterBytes = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 8)
	for i := range b {
		b[i] = letterBytes[rand.Intn(len(letterBytes))]
	}

	return string(b)
}

// 随机生成一个包含小写字母和数字的字符串，长度为16
// 用于生成salt
func GenerateRandomSalt() string {
	const letterBytes = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 16)
	for i := range b {
		b[i] = letterBytes[rand.Intn(len(letterBytes))]
	}
	return string(b)
}

// 计算密码的md5值
func EncryptPassword(password, salt string) string {
	return MD5(password + salt)
}
