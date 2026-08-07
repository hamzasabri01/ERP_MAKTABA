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

Pour activer manuellement l'ouverture automatique avec Windows:

```powershell
.\install-autostart.ps1
```

Au prochain login Windows, les services demarrent sans fenetre de commande
visible et le navigateur ouvre automatiquement `http://localhost:5173`.

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

## Mise a jour d'un PC deja utilise (sans perdre les produits)

Ne relancez pas `setup.ps1` pour mettre a jour une installation qui contient
deja des produits. Utilisez le script dedie depuis la racine du projet:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\update-existing.ps1
```

Ou double-cliquez sur `MISE-A-JOUR-SANS-PERTE.cmd`.

Le programme de mise a jour arrete temporairement l'application, sauvegarde la
base SQLite, les images produits, `.env`, les parametres de la librairie et les
fichiers de recherche dans `%LOCALAPPDATA%\LibrarySabri\upgrade-backups`. Il met
ensuite le code et les dependances a jour, applique uniquement les evolutions
additives du schema, puis compare le nombre de produits, ventes, achats et
mouvements avant/apres. En cas d'erreur, l'ancienne version et ses donnees sont
restaurees automatiquement.

Pour une tres ancienne copie qui ne contient pas encore le script, telechargez
uniquement `update-existing.ps1` depuis ce depot dans la racine de l'application
et executez-le. Il recuperera lui-meme le reste de l'outil avant toute mise a jour.

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
