from langchain_openai import ChatOpenAI

from .config import settings


def build_chat_model(streaming: bool = True, temperature: float | None = None) -> ChatOpenAI:
    return ChatOpenAI(
        model=settings.model_name,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        temperature=settings.temperature if temperature is None else temperature,
        streaming=streaming,
    )
