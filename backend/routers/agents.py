from fastapi import APIRouter
import asyncio
from pydantic import BaseModel
import time
import random

router = APIRouter(prefix="/agents", tags=["agents"])

class AgentActivity(BaseModel):
    id: str
    agent_id: str
    action: str
    target: str | None
    timestamp: float

# Mock state
agents = ["Prover", "Verifier", "Refuter", "Critic"]
activities = []

@router.get("/events")
async def get_agent_events():
    # Return 3 random mock recent events for the visualization graph
    mock_events = []
    for _ in range(3):
        agent = random.choice(agents)
        target = random.choice([a for a in agents if a != agent])
        action = random.choice([
            "Proposed a lemma",
            f"Checking proof from {target}",
            f"Found counterexample to {target}'s claim",
            "Consulting theorem database"
        ])
        mock_events.append({
            "id": str(random.randint(1000, 9999)),
            "agent_id": agent,
            "action": action,
            "target": target,
            "timestamp": time.time()
        })
    return mock_events
