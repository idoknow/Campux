package util

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
)

type StrArray []string

func (s StrArray) Value() (driver.Value, error) {
	if s == nil {
		return nil, nil
	}
	return json.Marshal(s)
}

func (s *StrArray) Scan(src interface{}) error {
	if src == nil {
		*s = make(StrArray, 0)
		return nil
	}
	switch src.(type) {
	case []byte:
		return json.Unmarshal(src.([]byte), s)
	case string:
		return json.Unmarshal([]byte(src.(string)), s)
	default:
		return errors.New("incompatible type for StrArray")
	}
}
