package util

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/spf13/viper"
)

// 生成jwt token
func GenerateJWTToken(uin int64) (string, error) {
	
	// 生成token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"uin": uin,
		"exp": time.Now().Add(time.Second * time.Duration(viper.GetInt("auth.jwt.expire"))).Unix(),
	})

	// 签名
	tokenString, err := token.SignedString([]byte(viper.GetString("auth.jwt.secret")))
	if err != nil {
		return "", err
	}

	return tokenString, nil
}

// 解析jwt token
func ParseJWTToken(tokenString string) (int64, error) {
	
	// 解析token
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return []byte(viper.GetString("auth.jwt.secret")), nil
	})
	if err != nil {
		return 0, err
	}

	// 获取uin
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return 0, err
	}

	uin, ok := claims["uin"].(float64)
	if !ok {
		return 0, err
	}

	return int64(uin), nil
}