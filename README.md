# Maktaba Print Web

Application de gestion pour une librairie avec vente de fournitures scolaires, gestion de stock, POS, clients, fournisseurs, achats, caisse, rapports, factures, tickets, photocopie et impression.

## Technologies

| Couche | Technologie |
| --- | --- |
| Frontend | React, Vite |
| Backend | Python, FastAPI |
| Base de donnees | SQLite |
| Documents | Tickets thermiques, factures, bons de commande |

## Installation locale Windows

Installation automatique recommandee apres clonage:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

`setup.ps1` installe automatiquement Python, Node.js et Cloudflared via
Winget lorsqu'ils sont absents, puis installe toutes les dependances.
`start.ps1` affiche a la fin le lien local et le lien LAN utilisable depuis
un autre ordinateur du meme reseau.

Backend:

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Frontend:

```powershell
cd frontend
npm install
copy .env.example .env
npm run dev
```

Acces local: `http://localhost:5173`

Identifiants initiaux par defaut si la base est vide: `admin` / `Sabri2026`.
Le mot de passe peut etre choisi pendant l'execution de `setup.ps1`.

Le script `setup.ps1` cree une base neuve sans produits, ventes, achats ni
donnees de demonstration. Pour ajouter volontairement les donnees de formation:

```powershell
cd backend
.\venv\Scripts\python.exe seed_training.py
```

## Domaines couverts

- Vente comptoir et tickets POS.
- Produits de librairie et fournitures scolaires.
- Services de photocopie, impression et reliure.
- Stock, achats, fournisseurs et alertes stock faible.
- Caisse, paiements, depenses et rapports.
- Factures, devis, bons de livraison et bons de commande.

## GitHub

Apres creation d'un depot vide sur GitHub:

```powershell
git remote add origin https://github.com/VOTRE_COMPTE/maktaba-print-web.git
git branch -M main
git push -u origin main
```
