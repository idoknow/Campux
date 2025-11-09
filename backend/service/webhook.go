package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/RockChinQ/Campux/backend/database"
)

type WebhookService struct {
	CommonService
}

type WebhookEvent struct {
	Event     string      `json:"event"`
	Timestamp int64       `json:"timestamp"`
	Data      interface{} `json:"data"`
}

type PostCreatedData struct {
	PostID    int      `json:"post_id"`
	UUID      string   `json:"uuid"`
	Uin       int64    `json:"uin"`
	Text      string   `json:"text"`
	Images    []string `json:"images"`
	Anon      bool     `json:"anon"`
	CreatedAt int64    `json:"created_at"`
}

func NewWebhookService(db database.BaseDBManager) *WebhookService {
	return &WebhookService{
		CommonService: CommonService{
			DB: db,
		},
	}
}

func (ws *WebhookService) GetWebhooks() ([]database.WebhookPO, error) {
	return ws.DB.GetWebhooks()
}

func (ws *WebhookService) TriggerPostCreated(post *database.PostPO) error {
	webhooks, err := ws.GetWebhooks()
	if err != nil || len(webhooks) == 0 {
		return nil
	}

	event := WebhookEvent{
		Event:     "post.created",
		Timestamp: time.Now().Unix(),
		Data: PostCreatedData{
			PostID:    post.ID,
			UUID:      post.UUID,
			Uin:       post.Uin,
			Text:      post.Text,
			Images:    post.Images,
			Anon:      post.Anon,
			CreatedAt: post.CreatedAt.Unix(),
		},
	}

	for _, webhook := range webhooks {
		if webhook.Enabled {
			go func(url string) {
				ws.sendWebhook(url, event)
			}(webhook.URL)
		}
	}

	return nil
}

func (ws *WebhookService) sendWebhook(url string, event WebhookEvent) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	client := &http.Client{
		Timeout: 120 * time.Second,
	}

	resp, err := client.Post(url, "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned status %d", resp.StatusCode)
	}

	return nil
}
