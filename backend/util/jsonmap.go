package util

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
)

type JSONMap map[string]interface{}

func (j JSONMap) Value() (driver.Value, error) {
	if j == nil {
		return nil, nil
	}
	return json.Marshal(j)
}

func (j *JSONMap) Scan(src interface{}) error {
	if src == nil {
		*j = make(JSONMap)
		return nil
	}
	switch s := src.(type) {
	case []byte:
		return json.Unmarshal(s, j)
	case string:
		return json.Unmarshal([]byte(s), j)
	default:
		return errors.New("incompatible type for JSONMap")
	}
}
