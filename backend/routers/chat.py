from fastapi import APIRouter
from pydantic import BaseModel
import asyncio
import os
from dotenv import load_dotenv

load_dotenv()

MODEL_NAME = os.getenv("CHATBOT_MODEL", "default-mock-model")

router = APIRouter(prefix="/chat", tags=["chat"])

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []

@router.post("/")
async def chat_interaction(request: ChatRequest):
    # Mock RAG response
    await asyncio.sleep(1) # Simulate processing time
    user_msg = request.message.lower()
    
    response_content = f"I am the RAG chatbot (Model: {MODEL_NAME}). "
    if "pythagoras" in user_msg or "pythagorean" in user_msg:
        response_content += "According to the verified theorem database (Theorem ID 1 in Lean4), the sum of the squares of the lengths of the legs of a right triangle is equal to the square of the length of the hypotenuse."
    elif "fermat" in user_msg:
        response_content += "Fermat's Last theorem for n=3 is verified in Rocq (Theorem ID 2)."
    else:
        response_content += "I can assist you with understanding verified proofs. How can I help you today?"
        
    return {"reply": response_content}
